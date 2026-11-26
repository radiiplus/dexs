const rpcUrl = process.env.ANVIL_URL || "http://127.0.0.1:8545";
const forkUrl = process.env.FORK_URL || "https://ethereum-rpc.publicnode.com";
const forkBlock = 26498904;
const pair = "0x4badcb6ad8352875290cb5e356f1de61450f9609";
const caller = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";

async function rpc(method, params) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const result = await response.json();
  if (result.error) throw new Error(JSON.stringify(result.error));
  return result.result;
}

async function call(data) {
  return rpc("eth_call", [{ to: pair, data }, "latest"]);
}

async function sendAndWait() {
  const hash = await rpc("eth_sendTransaction", [{
    from: caller,
    to: pair,
    data: "0x13966db5",
    gas: "0x30d40",
  }]);
  let receipt;
  while (!receipt) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    receipt = await rpc("eth_getTransactionReceipt", [hash]);
  }
  if (receipt.status !== "0x1") throw new Error(`mintFee reverted: ${hash}`);
  return receipt;
}

async function main() {
  await rpc("anvil_reset", [{ forking: { jsonRpcUrl: forkUrl, blockNumber: forkBlock } }]);

  const factory = `0x${(await call("0xc45a0155")).slice(-40)}`;
  const feeTo = `0x${(await rpc("eth_call", [{ to: factory, data: "0x017e7e58" }, "latest"])).slice(-40)}`;
  if (feeTo === "0x0000000000000000000000000000000000000000") {
    throw new Error("feeTo is zero at the pinned fork block");
  }

  const feeToBalanceData = `0x70a08231${feeTo.slice(2).padStart(64, "0")}`;
  const before = {
    supply: BigInt(await call("0x18160ddd")),
    feeToBalance: BigInt(await call(feeToBalanceData)),
    kLast: BigInt(await call("0x7464fc3d")),
    reserves: await call("0x0902f1ac"),
  };
  const receipts = [];
  for (let i = 0; i < 7; i++) receipts.push(await sendAndWait());

  const after = {
    supply: BigInt(await call("0x18160ddd")),
    feeToBalance: BigInt(await call(feeToBalanceData)),
    kLast: BigInt(await call("0x7464fc3d")),
    reserves: await call("0x0902f1ac"),
  };
  const supplyIncrease = after.supply - before.supply;
  if (supplyIncrease <= 0n) throw new Error("repeated mintFee calls did not increase supply");
  if (after.feeToBalance - before.feeToBalance !== supplyIncrease) {
    throw new Error("LP supply increase does not reconcile to feeTo's balance increase");
  }
  if (after.kLast !== before.kLast || after.reserves !== before.reserves) {
    throw new Error("mintFee unexpectedly changed kLast or reserves");
  }

  console.log(JSON.stringify({
    forkBlock,
    pair,
    factory,
    feeTo,
    calls: receipts.length,
    successfulCalls: receipts.filter((receipt) => receipt.status === "0x1").length,
    supplyBefore: before.supply.toString(),
    supplyAfter: after.supply.toString(),
    supplyIncrease: supplyIncrease.toString(),
    supplyIncreasePercent: Number((supplyIncrease * 10000n) / before.supply) / 100,
    feeToIncrease: (after.feeToBalance - before.feeToBalance).toString(),
    reservesUnchanged: true,
    kLastUnchanged: true,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
