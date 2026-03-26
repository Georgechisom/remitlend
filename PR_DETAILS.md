# PR Details

## PR Title

feat: add loan queries, grace period, emergency withdraw, and withdraw-all

## PR Summary

### Summary

**LoanManager — Loan Count & Active Loan Queries (#210)**

- `get_loan_count()` — returns total number of loans created
- `get_borrower_loan_ids(borrower: Address)` — returns all loan IDs for a specific borrower
- `get_active_loan_count()` — counts non-terminal loans (Pending + Approved)
- Added `DataKey::BorrowerLoans(Address)` to track per-borrower loan lists
- Automatically tracks borrower loans during `request_loan()`

**LoanManager — Grace Period Before Default (#211)**

- Added configurable grace period (default 4320 ledgers ≈ 6 hours)
- `check_default()` only marks loan as defaulted if `current_ledger > due_date + grace_period`
- `set_grace_period(ledgers: u32)` — admin-only function to update grace period
- `get_grace_period()` — query current grace period setting
- Emits `GracePeriodUpdated` event when grace period changes
- Added `due_date` field to `Loan` struct (set to 30 days from approval)

**LendingPool — Emergency Withdraw Bypassing Pause (#209)**

- `emergency_withdraw(provider: Address)` — works even when contract is paused
- Full withdrawal only (no partial withdrawals) for security
- Emits `EmergencyWithdraw` event
- Added pause functionality with `set_paused(bool)` admin function
- Added `DataKey::Paused` and `DataKey::Admin` to support pause mechanism
- Updated `initialize()` to accept admin parameter
- `deposit()` and `withdraw()` now check pause status

**LendingPool — Withdraw-All Convenience Function (#208)**

- `withdraw_all(provider: Address)` — reads deposit balance internally and withdraws full amount in one transaction
- Reduces gas costs by eliminating need for separate `get_deposit()` query
- Improves UX for depositors exiting the pool
- Emits `WithdrawAll` event
- Panics with "no deposit to withdraw" if balance is zero

**Test Results:**

- 33 tests passing (8 lending_pool + 9 loan_manager + 16 remittance_nft)
- `cargo fmt` — clean
- All test snapshots updated

**Closes #208 Closes #209 Closes #210 Closes #211**

### Test Plan

- `cargo fmt --all` — clean
- `cargo test` — 33/33 pass
- LoanManager: loan queries, grace period, default checking tests
- LendingPool: emergency withdraw, withdraw-all, pause functionality tests
- All existing tests continue to pass with new functionality
