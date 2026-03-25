#![no_std]
use soroban_sdk::token::Client as TokenClient;
use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Deposit(Address),
    Paused,
    Admin,
}

#[contract]
pub struct LendingPool;

#[contractimpl]
impl LendingPool {
    fn token_key() -> soroban_sdk::Symbol {
        symbol_short!("TOKEN")
    }

    fn read_token(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&Self::token_key())
            .expect("not initialized")
    }

    pub fn initialize(env: Env, token: Address, admin: Address) {
        let token_key = Self::token_key();
        if env.storage().instance().has(&token_key) {
            panic!("already initialized");
        }
        env.storage().instance().set(&token_key, &token);
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Paused, &false);
    }

    fn assert_not_paused(env: &Env) {
        let paused: bool = env
            .storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false);
        if paused {
            panic!("contract is paused");
        }
    }

    pub fn set_paused(env: Env, paused: bool) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();
        env.storage().instance().set(&DataKey::Paused, &paused);
        env.events().publish((symbol_short!("Paused"),), paused);
    }

    pub fn deposit(env: Env, provider: Address, amount: i128) {
        provider.require_auth();
        Self::assert_not_paused(&env);
        if amount <= 0 {
            panic!("deposit amount must be positive");
        }
        let token = Self::read_token(&env);
        let token_client = TokenClient::new(&env, &token);
        token_client.transfer(&provider, &env.current_contract_address(), &amount);
        let key = DataKey::Deposit(provider.clone());
        let mut current_balance: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        current_balance = current_balance
            .checked_add(amount)
            .expect("deposit overflow");
        env.storage().persistent().set(&key, &current_balance);
        env.events()
            .publish((symbol_short!("Deposit"), provider), amount);
    }

    pub fn get_deposit(env: Env, provider: Address) -> i128 {
        let key = DataKey::Deposit(provider);
        env.storage().persistent().get(&key).unwrap_or(0)
    }

    pub fn withdraw(env: Env, provider: Address, amount: i128) {
        provider.require_auth();
        Self::assert_not_paused(&env);
        if amount <= 0 {
            panic!("withdraw amount must be positive");
        }
        let key = DataKey::Deposit(provider.clone());
        let current_balance: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        if current_balance < amount {
            panic!("insufficient balance");
        }
        let token = Self::read_token(&env);
        let token_client = TokenClient::new(&env, &token);
        let pool_address = env.current_contract_address();
        let pool_balance = token_client.balance(&pool_address);
        if pool_balance < amount {
            panic!("insufficient pool liquidity");
        }
        token_client.transfer(&pool_address, &provider, &amount);
        let new_balance = current_balance
            .checked_sub(amount)
            .expect("withdraw underflow");
        if new_balance == 0 {
            env.storage().persistent().remove(&key);
        } else {
            env.storage().persistent().set(&key, &new_balance);
        }
        env.events()
            .publish((symbol_short!("Withdraw"), provider), amount);
    }

    // Issue #208: Withdraw all convenience function
    pub fn withdraw_all(env: Env, provider: Address) {
        provider.require_auth();
        Self::assert_not_paused(&env);
        let key = DataKey::Deposit(provider.clone());
        let balance: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        if balance == 0 {
            panic!("no deposit to withdraw");
        }

        let token = Self::read_token(&env);
        let token_client = TokenClient::new(&env, &token);
        let pool_address = env.current_contract_address();
        let pool_balance = token_client.balance(&pool_address);
        if pool_balance < balance {
            panic!("insufficient pool liquidity");
        }

        token_client.transfer(&pool_address, &provider, &balance);
        env.storage().persistent().remove(&key);
        env.events()
            .publish((symbol_short!("WithdAll"), provider), balance);
    }

    // Issue #209: Emergency withdraw bypassing pause
    pub fn emergency_withdraw(env: Env, provider: Address) {
        provider.require_auth();
        let key = DataKey::Deposit(provider.clone());
        let balance: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        if balance == 0 {
            panic!("no deposit to withdraw");
        }

        let token = Self::read_token(&env);
        let token_client = TokenClient::new(&env, &token);
        let pool_address = env.current_contract_address();
        let pool_balance = token_client.balance(&pool_address);
        if pool_balance < balance {
            panic!("insufficient pool liquidity");
        }

        // Full withdrawal only
        token_client.transfer(&pool_address, &provider, &balance);
        env.storage().persistent().remove(&key);
        env.events()
            .publish((symbol_short!("EmergWd"), provider), balance);
    }

    pub fn get_token(env: Env) -> Address {
        Self::read_token(&env)
    }
}

#[cfg(test)]
mod test;
