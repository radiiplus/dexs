const SakeSwapFactory = artifacts.require("SakeSwapFactory");
const SakeSwapPair = artifacts.require("SakeSwapPair");
const SakeSwapSlippageToken = artifacts.require("SakeSwapSlippageToken");
const MockERC20 = artifacts.require("MockERC20");

contract("SakeSwap slippage mint regression", (accounts) => {
  it("mints SST without transferring input or executing a swap", async () => {
    const factory = await SakeSwapFactory.new(accounts[0]);
    const tokenA = await MockERC20.new("Token A", "A", "100000000000000000000000");
    const tokenB = await MockERC20.new("Token B", "B", "100000000000000000000000");
    await factory.createPair(tokenA.address, tokenB.address);
    const pair = await SakeSwapPair.at(await factory.getPair(tokenA.address, tokenB.address));
    const token0Address = await pair.token0();
    const token0 = token0Address.toLowerCase() === tokenA.address.toLowerCase() ? tokenA : tokenB;
    const token1 = token0 === tokenA ? tokenB : tokenA;
    const liquidity = web3.utils.toBN("1000000000000000000000");

    await token0.transfer(pair.address, liquidity);
    await token1.transfer(pair.address, liquidity);
    await pair.mint(accounts[0]);

    const reservesBefore = await pair.getReserves();
    const balance0Before = await token0.balanceOf(pair.address);
    const balance1Before = await token1.balanceOf(pair.address);
    const sst = await SakeSwapSlippageToken.at(await pair.stoken());
    const sstBefore = await sst.balanceOf(accounts[1]);
    const arbitraryOutput = web3.utils.toBN(reservesBefore[1].toString()).div(web3.utils.toBN(2));

    await pair.dealSlippageWithOut([token0.address, token1.address], arbitraryOutput, accounts[1], true, {
      from: accounts[1],
    });

    assert((await sst.balanceOf(accounts[1])).gt(sstBefore), "SST was not minted");
    assert.equal((await token0.balanceOf(pair.address)).toString(), balance0Before.toString());
    assert.equal((await token1.balanceOf(pair.address)).toString(), balance1Before.toString());
    const reservesAfter = await pair.getReserves();
    assert.equal(reservesAfter[0].toString(), reservesBefore[0].toString());
    assert.equal(reservesAfter[1].toString(), reservesBefore[1].toString());
  });
});
