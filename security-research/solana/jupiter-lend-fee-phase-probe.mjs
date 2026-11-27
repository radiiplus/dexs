import assert from "node:assert/strict";
import { Surfnet } from "@solana/surfpool";
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import {
  ExtensionType,
  getExtensionData,
  getTransferFeeConfig,
  TOKEN_2022_PROGRAM_ID,
  TransferFeeConfigLayout,
  unpackMint,
} from "@solana/spl-token";
import BN from "bn.js";
import { getOperateDexIx, getOperatePerfectDexIx } from "@jup-ag/lend/borrow";

const parentRpc = process.env.JUPLEND_FORK_RPC ?? "http://127.0.0.1:8899";
const surfnet = Surfnet.startWithConfig({ remoteRpcUrl: parentRpc });

try {
  const connection = new Connection(surfnet.rpcUrl, "confirmed");
  const signerKeypair = Keypair.generate();
  const signer = signerKeypair.publicKey;
  surfnet.fundSol(signer.toBase58(), 2_000_000_000);

  const usdgo = new PublicKey("72puLt71H93Z9CzHuBRTwFpL4TG3WZUhnoCC7p8gxigu");
  const usdc = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  const open = await getOperateDexIx({
    connection,
    signer,
    vaultId: 105,
    positionId: 0,
    includeATASetup: false,
    col: { action: "supply", input: { token0: new BN(1_000_000), token1: new BN(1_000_000), minShares: new BN(1) } },
  });

  surfnet.setTokenAccount(signer.toBase58(), usdgo.toBase58(), { amount: 10_000_000_000, state: "initialized" }, TOKEN_2022_PROGRAM_ID.toBase58());
  surfnet.setTokenAccount(signer.toBase58(), usdc.toBase58(), { amount: 10_000_000_000, state: "initialized" });
  const openIxs = open.ixs.filter((ix) => !ix.data.subarray(0, 8).equals(Buffer.from([22, 13, 62, 141, 73, 89, 178, 29])));
  const { blockhash: openBlockhash } = await connection.getLatestBlockhash("confirmed");
  const openMessage = new TransactionMessage({
    payerKey: signer,
    recentBlockhash: openBlockhash,
    instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), ...openIxs],
  }).compileToV0Message(open.addressLookupTableAccounts);
  const openTx = new VersionedTransaction(openMessage);
  openTx.sign([signerKeypair]);
  const openSignature = await connection.sendTransaction(openTx, { skipPreflight: false, preflightCommitment: "confirmed" });
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const status = await connection.getSignatureStatuses([openSignature]);
    if (status.value[0]?.err) throw new Error(`synthetic deposit failed: ${JSON.stringify(status.value[0].err)}`);
    if (status.value[0]?.confirmationStatus) break;
    if (attempt === 19) throw new Error(`synthetic deposit was not observed: ${openSignature}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  const tokenAccounts = [open.accounts.supplyDex.dexUserToken0Account, open.accounts.supplyDex.dexUserToken1Account];
  const before = await Promise.all(tokenAccounts.map(async (address) => {
    const info = await connection.getAccountInfo(address, "confirmed");
    return BigInt(info.data.readBigUInt64LE(64));
  }));
  const withdraw = await getOperatePerfectDexIx({
    connection,
    signer,
    vaultId: 105,
    positionId: open.nftId,
    includeATASetup: false,
    col: { action: "withdraw", input: { max: true, minToken0: new BN(1), minToken1: new BN(1) } },
  });
  const mainIx = withdraw.ixs.find((ix) => ix.data.subarray(0, 8).equals(Buffer.from([88, 34, 180, 77, 152, 186, 166, 162])));
  const coder = (await import("@jup-ag/lend/borrow")).getVaultsProgram({ connection, signer }).coder.instruction;
  const originalArgs = coder.decode(mainIx.data).data;

  async function simulate(args) {
    const modified = { ...mainIx, data: coder.encode("operatePerfectDex", args) };
    const ixs = withdraw.ixs
      .filter((ix) => !ix.data.subarray(0, 8).equals(Buffer.from([22, 13, 62, 141, 73, 89, 178, 29])))
      .map((ix) => ix === mainIx ? modified : ix);
    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    const message = new TransactionMessage({
      payerKey: signer,
      recentBlockhash: blockhash,
      instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), ...ixs],
    }).compileToV0Message(withdraw.addressLookupTableAccounts);
    const tx = new VersionedTransaction(message);
    tx.sign([signerKeypair]);
    return connection.simulateTransaction(tx, {
      sigVerify: false,
      replaceRecentBlockhash: true,
      commitment: "confirmed",
      accounts: { encoding: "base64", addresses: tokenAccounts.map((address) => address.toBase58()) },
    });
  }

  const noFee = await simulate(originalArgs);
  assert.equal(noFee.value.err, null, "baseline no-fee withdrawal must succeed");
  const noFeeAfter = noFee.value.accounts.map((account) => BigInt(Buffer.from(account.data[0], "base64").readBigUInt64LE(64)));
  const grossOut = noFeeAfter.map((balance, index) => balance - before[index]);

  const mintInfo = await connection.getAccountInfo(usdgo, "confirmed");
  const mintState = unpackMint(usdgo, mintInfo, TOKEN_2022_PROGRAM_ID);
  const extension = getExtensionData(ExtensionType.TransferFeeConfig, mintState.tlvData);
  const feeConfig = getTransferFeeConfig(mintState);
  if (!extension || !feeConfig) throw new Error("USDGO transfer-fee extension missing");
  feeConfig.olderTransferFee.epoch = 0n;
  feeConfig.olderTransferFee.transferFeeBasisPoints = 100;
  feeConfig.olderTransferFee.maximumFee = 1_000_000_000n;
  feeConfig.newerTransferFee.epoch = 0n;
  feeConfig.newerTransferFee.transferFeeBasisPoints = 100;
  feeConfig.newerTransferFee.maximumFee = 1_000_000_000n;
  TransferFeeConfigLayout.encode(feeConfig, extension);
  surfnet.setAccount(usdgo.toBase58(), mintInfo.lamports, mintInfo.data, mintInfo.owner.toBase58());

  const exactGrossMinArgs = coder.decode(mainIx.data).data;
  exactGrossMinArgs.colAmounts.amounts.token0MinMax = new BN(grossOut[0].toString()).neg();
  exactGrossMinArgs.colAmounts.amounts.token1MinMax = new BN(grossOut[1].toString()).neg();
  const feeOn = await simulate(exactGrossMinArgs);
  assert.equal(feeOn.value.err, null, "withdrawal at exact gross minimum unexpectedly reverted");
  const feeOnAfter = feeOn.value.accounts.map((account) => BigInt(Buffer.from(account.data[0], "base64").readBigUInt64LE(64)));
  const netOut = feeOnAfter.map((balance, index) => balance - before[index]);
  assert(netOut[0] < grossOut[0], "recipient should receive less USDGO than the gross minimum");

  const grossPlusOneArgs = coder.decode(mainIx.data).data;
  grossPlusOneArgs.colAmounts.amounts.token0MinMax = new BN((grossOut[0] + 1n).toString()).neg();
  grossPlusOneArgs.colAmounts.amounts.token1MinMax = new BN(grossOut[1].toString()).neg();
  const grossPlusOne = await simulate(grossPlusOneArgs);
  assert.notEqual(grossPlusOne.value.err, null, "gross minimum above calculated output should revert");

  const lateDeposit = await getOperateDexIx({
    connection,
    signer,
    vaultId: 105,
    positionId: 0,
    includeATASetup: false,
    col: { action: "supply", input: { token0: new BN(1_000_000), token1: new BN(1_000_000), minShares: new BN(1) } },
  });
  const lateDepositIxs = lateDeposit.ixs.filter((ix) => !ix.data.subarray(0, 8).equals(Buffer.from([22, 13, 62, 141, 73, 89, 178, 29])));
  const { blockhash: lateBlockhash } = await connection.getLatestBlockhash("confirmed");
  const lateMessage = new TransactionMessage({
    payerKey: signer,
    recentBlockhash: lateBlockhash,
    instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), ...lateDepositIxs],
  }).compileToV0Message(lateDeposit.addressLookupTableAccounts);
  const lateTx = new VersionedTransaction(lateMessage);
  lateTx.sign([signerKeypair]);
  const lateDepositResult = await connection.simulateTransaction(lateTx, { sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" });

  console.log(JSON.stringify({
    parentForkRpc: parentRpc,
    localPositionId: open.nftId,
    openSignature: openSignature,
    simulatedFeeBps: 100,
    grossMinimum: grossOut.map(String),
    recipientNet: netOut.map(String),
    shortfall: grossOut.map((amount, index) => (amount - netOut[index]).toString()),
    exactGrossMinimumError: feeOn.value.err,
    grossMinimumPlusOneError: grossPlusOne.value.err,
    grossMinimumPlusOneLogs: grossPlusOne.value.logs?.slice(-7),
    feeOnDepositError: lateDepositResult.value.err,
    feeOnDepositLogs: lateDepositResult.value.logs?.slice(-12),
  }, null, 2));
} finally {
  surfnet.stop();
}
