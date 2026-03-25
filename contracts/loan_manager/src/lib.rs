#![no_std]
use soroban_sdk::{
    contract, contractclient, contractimpl, contracttype, symbol_short, Address, Env,
};

#[contractclient(name = "NftClient")]
pub trait RemittanceNftInterface {
    fn get_score(env: Env, user: Address) -> u32;
    fn update_score(env: Env, user: Address, repayment_amount: i128, minter: Option<Address>);
}

mod events;

#[contracttype]
#[derive(Clone, PartialEq, Debug)]
pub enum LoanStatus {
    Pending,
    Approved,
    Repaid,
    Defaulted,
}

#[contracttype]
#[derive(Clone)]
pub struct Loan {
    pub borrower: Address,
    pub amount: i128,
    pub status: LoanStatus,
    pub due_date: u32,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    NftContract,
    LendingPool,
    Token,
    Admin,
    Loan(u32),
    LoanCounter,
    BorrowerLoans(Address),
    GracePeriod,
}

#[contract]
pub struct LoanManager;

#[contractimpl]
impl LoanManager {
    pub fn initialize(
        env: Env,
        nft_contract: Address,
        lending_pool: Address,
        token: Address,
        admin: Address,
    ) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage()
            .instance()
            .set(&DataKey::NftContract, &nft_contract);
        env.storage()
            .instance()
            .set(&DataKey::LendingPool, &lending_pool);
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::LoanCounter, &0u32);
        env.storage()
            .instance()
            .set(&DataKey::GracePeriod, &4320u32); // Default 6 hours
    }

    pub fn request_loan(env: Env, borrower: Address, amount: i128) -> u32 {
        borrower.require_auth();

        if amount <= 0 {
            panic!("loan amount must be positive");
        }

        let nft_contract: Address = env
            .storage()
            .instance()
            .get(&DataKey::NftContract)
            .expect("not initialized");
        let nft_client = NftClient::new(&env, &nft_contract);

        let score = nft_client.get_score(&borrower);
        if score < 500 {
            panic!("score too low for loan");
        }

        // Create loan record
        let mut loan_counter: u32 = env
            .storage()
            .instance()
            .get(&DataKey::LoanCounter)
            .unwrap_or(0);
        loan_counter += 1;

        let loan = Loan {
            borrower: borrower.clone(),
            amount,
            status: LoanStatus::Pending,
            due_date: 0, // Set when approved
        };

        env.storage()
            .persistent()
            .set(&DataKey::Loan(loan_counter), &loan);
        env.storage()
            .instance()
            .set(&DataKey::LoanCounter, &loan_counter);

        // Track borrower's loans
        let borrower_key = DataKey::BorrowerLoans(borrower.clone());
        let mut borrower_loans: soroban_sdk::Vec<u32> = env
            .storage()
            .persistent()
            .get(&borrower_key)
            .unwrap_or(soroban_sdk::Vec::new(&env));
        borrower_loans.push_back(loan_counter);
        env.storage()
            .persistent()
            .set(&borrower_key, &borrower_loans);

        events::loan_requested(&env, borrower.clone(), amount);
        env.events()
            .publish((symbol_short!("LoanReq"), borrower), loan_counter);

        loan_counter
    }

    pub fn approve_loan(env: Env, loan_id: u32) {
        use soroban_sdk::token::TokenClient;

        // Access control: only admin can approve loans
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();

        // Get loan record
        let loan_key = DataKey::Loan(loan_id);
        let mut loan: Loan = env
            .storage()
            .persistent()
            .get(&loan_key)
            .expect("loan not found");

        // Check loan status
        if loan.status != LoanStatus::Pending {
            panic!("loan is not pending");
        }

        // Update loan status to Approved and set due date (30 days from now)
        loan.status = LoanStatus::Approved;
        loan.due_date = env.ledger().sequence() + 432000; // ~30 days
        env.storage().persistent().set(&loan_key, &loan);

        // Transfer funds from LendingPool to borrower
        let lending_pool: Address = env
            .storage()
            .instance()
            .get(&DataKey::LendingPool)
            .expect("lending pool not set");
        let token: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .expect("token not set");
        let token_client = TokenClient::new(&env, &token);
        token_client.transfer(&lending_pool, &loan.borrower, &loan.amount);

        events::loan_approved(&env, loan_id);
        env.events()
            .publish((symbol_short!("LoanAppr"), loan.borrower.clone()), loan_id);
    }

    pub fn get_loan(env: Env, loan_id: u32) -> Loan {
        env.storage()
            .persistent()
            .get(&DataKey::Loan(loan_id))
            .expect("loan not found")
    }

    pub fn repay(env: Env, borrower: Address, amount: i128) {
        borrower.require_auth();
        if amount <= 0 {
            panic!("repayment amount must be positive");
        }

        // Repayment logic (placeholder)

        // Skip cross-contract call when repayment rounds to zero score points.
        if amount >= 100 {
            let nft_contract: Address = env
                .storage()
                .instance()
                .get(&DataKey::NftContract)
                .expect("not initialized");
            let nft_client = NftClient::new(&env, &nft_contract);
            nft_client.update_score(&borrower, &amount, &None);
        }

        events::loan_repaid(&env, borrower, amount);
    }

    // Issue #210: Query functions for loan count and borrower loans
    pub fn get_loan_count(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::LoanCounter)
            .unwrap_or(0)
    }

    pub fn get_borrower_loan_ids(env: Env, borrower: Address) -> soroban_sdk::Vec<u32> {
        let key = DataKey::BorrowerLoans(borrower);
        env.storage()
            .persistent()
            .get(&key)
            .unwrap_or(soroban_sdk::Vec::new(&env))
    }

    pub fn get_active_loan_count(env: Env) -> u32 {
        let total_loans = Self::get_loan_count(env.clone());
        let mut active_count = 0u32;

        for loan_id in 1..=total_loans {
            if let Some(loan) = env
                .storage()
                .persistent()
                .get::<DataKey, Loan>(&DataKey::Loan(loan_id))
            {
                if loan.status == LoanStatus::Pending || loan.status == LoanStatus::Approved {
                    active_count += 1;
                }
            }
        }

        active_count
    }

    // Issue #211: Grace period management
    pub fn set_grace_period(env: Env, ledgers: u32) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();

        env.storage()
            .instance()
            .set(&DataKey::GracePeriod, &ledgers);
        env.events().publish((symbol_short!("GracePrd"),), ledgers);
    }

    pub fn get_grace_period(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::GracePeriod)
            .unwrap_or(4320)
    }

    pub fn check_default(env: Env, loan_id: u32) {
        let loan_key = DataKey::Loan(loan_id);
        let mut loan: Loan = env
            .storage()
            .persistent()
            .get(&loan_key)
            .expect("loan not found");

        if loan.status != LoanStatus::Approved {
            return;
        }

        let grace_period = Self::get_grace_period(env.clone());
        let current_ledger = env.ledger().sequence();

        // Only mark as defaulted if past due date + grace period
        if current_ledger > loan.due_date + grace_period {
            loan.status = LoanStatus::Defaulted;
            env.storage().persistent().set(&loan_key, &loan);
            env.events()
                .publish((symbol_short!("Default"), loan.borrower.clone()), loan_id);
        }
    }
}

#[cfg(test)]
mod test;
