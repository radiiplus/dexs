const rpcUrl = process.env.ANVIL_URL || "http://127.0.0.1:8545";
const pair = "0xfdd05552f1377aa488afed744c8024358af02041";
const router = "0x9bd63c5d44ff28390df1eaafd4eb4bd73e94a72a";
const weth = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const user = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
const amountIn = 10n ** 17n;
const uint112Modulus = 1n << 112n;

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

const word = (value) => BigInt(value).toString(16).padStart(64, "0");

async function call(to, data, from = user) {
  return rpc("eth_call", [{ from, to, data }, "latest"]);
}

async function reserves() {
  const data = await call(pair, "0x0902f1ac");
  return [BigInt(`0x${data.slice(2, 66)}`), BigInt(`0x${data.slice(66, 130)}`)];
}

async function balance(token) {
  const data = await call(token, `0x70a08231${pair.slice(2).padStart(64, "0")}`);
  return BigInt(data);
}

async function sendAndWait(tx) {
  const hash = await rpc("eth_sendTransaction", [tx]);
  let receipt;
  while (!receipt) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    receipt = await rpc("eth_getTransactionReceipt", [hash]);
  }
  if (receipt.status !== "0x1") throw new Error(`router swap reverted: ${hash}`);
  return receipt;
}

async function main() {
  const [reserve0Before, reserve1Before] = await reserves();
  const reserveProductBefore = reserve0Before * reserve1Before;
  const wrappedThreshold = reserveProductBefore % uint112Modulus;
  if (reserveProductBefore <= uint112Modulus || wrappedThreshold >= reserveProductBefore) {
    throw new Error("sample reserves do not cross the uint112 product boundary");
  }

  const token0 = `0x${(await call(pair, "0x0dfe1681")).slice(-40)}`.toLowerCase();
  const token1 = `0x${(await call(pair, "0xd21220a7")).slice(-40)}`.toLowerCase();
  if (token0 !== weth) throw new Error(`unexpected token0: ${token0}`);

  const directPairSwap =
    `0x022c0d9f${word(reserve0Before / 2n)}${word(0n)}` +
    `${user.slice(2).padStart(64, "0")}${word(128n)}${word(0n)}`;
  let directCallError;
  try {
    await call(pair, directPairSwap);
  } catch (error) {
    directCallError = String(error);
  }
  if (!directCallError?.includes("FORBIDDEN")) {
    throw new Error(`expected direct pair swap to fail FORBIDDEN; got ${directCallError || "success"}`);
  }

  const buyTotalFee = BigInt(await call(pair, "0x3705b392"));
  const feeInWei = BigInt(await call(router, `0x59020530${word(buyTotalFee)}`));
  const deadline = 9_999_999_999n;
  const swapData =
    `0xb6f9de95${word(0n)}${word(128n)}${user.slice(2).padStart(64, "0")}` +
    `${word(deadline)}${word(2n)}${weth.slice(2).padStart(64, "0")}${token1.slice(2).padStart(64, "0")}`;
  const receipt = await sendAndWait({
    from: user,
    to: router,
    data: swapData,
    value: `0x${(amountIn + feeInWei).toString(16)}`,
    gas: "0x7a120",
  });

  const [reserve0After, reserve1After] = await reserves();
  const [balance0After, balance1After] = await Promise.all([balance(token0), balance(token1)]);
  const reserveProductAfter = reserve0After * reserve1After;
  if (reserveProductAfter < reserveProductBefore) {
    throw new Error("exact-input router swap reduced the full-width reserve product");
  }
  if (balance0After !== reserve0After || balance1After !== reserve1After) {
    throw new Error("post-swap token balances do not reconcile to reserves");
  }

  console.log(JSON.stringify({
    block: receipt.blockNumber,
    gasUsed: BigInt(receipt.gasUsed).toString(),
    status: receipt.status,
    reserveProductBefore: reserveProductBefore.toString(),
    malformedUint112Threshold: wrappedThreshold.toString(),
    reserveProductAfter: reserveProductAfter.toString(),
    directPairCall: "reverts FORBIDDEN",
    publicRouterCall: "exact-input swap succeeds; full-width reserve product does not decrease",
    balancesEqualReserves: true,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
