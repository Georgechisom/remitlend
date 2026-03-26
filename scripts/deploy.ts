import { 
  Keypair, 
  Operation, 
  TransactionBuilder, 
  Rpc,
  Address,
  nativeToScVal,
  xdr,
  StrKey
} from '@stellar/stellar-sdk';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

const CONFIG_PATH = path.join(__dirname, 'deploy-config.json');

async function sendTransaction(server: Rpc.Server, tx: xdr.TransactionEnvelope, account: Keypair, networkPassphrase: string) {
    let response = await server.simulateTransaction(tx);
    if (Rpc.Api.isSimulationError(response)) {
        throw new Error(`Simulation failed: ${JSON.stringify(response.error, null, 2)}`);
    }

    // Prepare transaction with simulation results
    const preparedTx = await server.prepareTransaction(tx);
    preparedTx.sign(account);
    
    let sendResponse = await server.sendTransaction(preparedTx);
    if (sendResponse.status !== 'PENDING') {
        throw new Error(`Send transaction failed: ${JSON.stringify(sendResponse, null, 2)}`);
    }

    console.log(`Transaction sent. Hash: ${sendResponse.hash}. Waiting for confirmation...`);
    
    let txResponse = await server.getTransaction(sendResponse.hash);
    while (txResponse.status === 'NOT_FOUND') {
        await new Promise(resolve => setTimeout(resolve, 2000));
        txResponse = await server.getTransaction(sendResponse.hash);
    }
    
    if (txResponse.status === 'FAILED') {
        throw new Error(`Transaction failed: ${JSON.stringify(txResponse.resultXdr, null, 2)}`);
    }

    return txResponse;
}

async function uploadWasm(server: Rpc.Server, wasmPath: string, account: Keypair, networkPassphrase: string) {
    const wasm = await fs.readFile(wasmPath);
    const source = await server.getAccount(account.publicKey());
    
    const tx = new TransactionBuilder(source, {
        fee: '10000',
        networkPassphrase
    })
    .addOperation(Operation.uploadContractWasm({ wasm }))
    .setTimeout(30)
    .build();

    const result = await sendTransaction(server, tx, account, networkPassphrase);
    if (!result.resultMetaXdr) throw new Error('Missing resultMetaXdr');
    
    // Extract WASM ID from the transaction result
    // In a real scenario, you'd parse the XDR to find the wasmId
    // For this script, we'll use the simulation result which includes it
    const sim = await server.simulateTransaction(tx);
    if (Rpc.Api.isSimulationSuccess(sim) && sim.result) {
        return (sim as any).result.wasmId;
    }
    throw new Error('Could not determine WASM ID');
}

async function createInstance(server: Rpc.Server, wasmId: string, account: Keypair, networkPassphrase: string) {
    const source = await server.getAccount(account.publicKey());
    const tx = new TransactionBuilder(source, {
        fee: '10000',
        networkPassphrase
    })
    .addOperation(Operation.createSmartContract({
        wasmId,
        address: Address.fromString(account.publicKey())
    }))
    .setTimeout(30)
    .build();

    const result = await sendTransaction(server, tx, account, networkPassphrase);
    // Extract contract ID from meta XDR
    const sim = await server.simulateTransaction(tx);
    if (Rpc.Api.isSimulationSuccess(sim) && sim.result) {
        return (sim as any).result.address;
    }
    throw new Error('Could not determine Contract ID');
}

async function invoke(server: Rpc.Server, contractId: string, method: string, args: any[], account: Keypair, networkPassphrase: string) {
    const source = await server.getAccount(account.publicKey());
    const tx = new TransactionBuilder(source, {
        fee: '10000',
        networkPassphrase
    })
    .addOperation(Operation.invokeHostFunction({
        func: xdr.HostFunction.hostFunctionTypeInvokeContract(
            new xdr.InvokeContractArgs({
                contractAddress: Address.fromString(contractId).toScAddress(),
                functionName: method,
                args: args.map(arg => nativeToScVal(arg))
            })
        ),
        auth: []
    }))
    .setTimeout(30)
    .build();

    return sendTransaction(server, tx, account, networkPassphrase);
}

async function main() {
    const network = process.argv[2] || 'testnet';
    const config = (await fs.readJson(CONFIG_PATH))[network];
    if (!config) throw new Error(`No config for network: ${network}`);

    const secretKey = process.env.SECRET_KEY;
    if (!secretKey) throw new Error('SECRET_KEY env required');
    const account = Keypair.fromSecret(secretKey);
    const adminAddr = config.admin === 'YOUR_ADMIN_PUBLIC_KEY' ? account.publicKey() : config.admin;

    const server = new Rpc.Server(config.rpcUrl);
    const passphrase = config.networkPassphrase;

    console.log(`Starting deployment on ${network}...`);

    // 1. Deploy Remittance NFT
    const nftWasmId = await uploadWasm(server, path.resolve(__dirname, config.contracts.remittance_nft.wasm), account, passphrase);
    const nftContractId = await createInstance(server, nftWasmId, account, passphrase);
    console.log(`NFT Contract Deployed: ${nftContractId}`);

    // 2. Deploy Lending Pool
    const poolWasmId = await uploadWasm(server, path.resolve(__dirname, config.contracts.lending_pool.wasm), account, passphrase);
    const poolContractId = await createInstance(server, poolWasmId, account, passphrase);
    console.log(`Pool Contract Deployed: ${poolContractId}`);

    // 3. Deploy Loan Manager
    const managerWasmId = await uploadWasm(server, path.resolve(__dirname, config.contracts.loan_manager.wasm), account, passphrase);
    const managerContractId = await createInstance(server, managerWasmId, account, passphrase);
    console.log(`Manager Contract Deployed: ${managerContractId}`);

    // 4. Initialize Contracts
    console.log('Initializing contracts...');
    await invoke(server, nftContractId, 'initialize', [adminAddr], account, passphrase);
    await invoke(server, poolContractId, 'initialize', [config.token, adminAddr], account, passphrase);
    await invoke(server, managerContractId, 'initialize', [nftContractId, poolContractId, config.token, adminAddr], account, passphrase);

    // 5. Link Contracts
    console.log('Linking contracts...');
    await invoke(server, nftContractId, 'authorize_minter', [managerContractId], account, passphrase);

    // 6. Save to .env files
    const envData = `
# RemitLend Contract IDs (${network})
NEXT_PUBLIC_NFT_CONTRACT_ID=${nftContractId}
NEXT_PUBLIC_POOL_CONTRACT_ID=${poolContractId}
NEXT_PUBLIC_MANAGER_CONTRACT_ID=${managerContractId}
`;

    await fs.appendFile(path.join(__dirname, '../frontend/.env.local'), envData);
    await fs.appendFile(path.join(__dirname, '../backend/.env'), envData);

    console.log('Deployment complete! Contract IDs saved to .env files.');
}

main().catch(error => {
    console.error('Deployment failed:');
    console.error(error);
    process.exit(1);
});
