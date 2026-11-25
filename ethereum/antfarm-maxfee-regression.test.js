const assert = require("node:assert/strict");
const solc = require("solc");
const ganache = require("ganache");
const { ethers } = require("ethers");

const sourcesByAddress = {
  "0xe48aee124f9933661d4dd3eb265fa9e153e32cbe": "contracts/antfarm/AntfarmFactory.sol",
  "0x6d9f0eb21d77c6d24be49a579508471e937d5418": "contracts/antfarm/AntfarmRouter.sol",
  "0x518b63da813d46556fea041a88b52e3caa8c16a8": "contracts/antfarm/AntfarmToken.sol",
};

const feeTokenPath = "contracts/test/FeeToken.sol";
const feeTokenSource = `// SPDX-License-Identifier: MIT
pragma solidity =0.8.10;
contract FeeToken {
    uint8 public decimals = 6;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    function mint(address account, uint256 amount) external {
        balanceOf[account] += amount;
        totalSupply += amount;
    }
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }
    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        _transfer(from, to, amount);
        return true;
    }
    function _transfer(address from, address to, uint256 amount) internal {
        balanceOf[from] -= amount;
        uint256 received = amount * 90 / 100;
        balanceOf[to] += received;
        totalSupply -= amount - received;
    }
}`;

async function getSource(address) {
  const response = await fetch(`https://eth.blockscout.com/api/v2/smart-contracts/${address}`);
  if (!response.ok) throw new Error(`Blockscout returned ${response.status} for ${address}`);
  return response.json();
}

async function main() {
  const verified = await Promise.all(Object.keys(sourcesByAddress).map(getSource));
  const sources = { [feeTokenPath]: { content: feeTokenSource } };
  for (const contract of verified) {
    sources[contract.file_path] = { content: contract.source_code };
    for (const dependency of contract.additional_sources || []) {
      sources[dependency.file_path] = { content: dependency.source_code };
    }
  }

  const input = {
    language: "Solidity",
    sources,
    settings: {
      optimizer: { enabled: true, runs: 1000 },
      metadata: { useLiteralContent: true },
      outputSelection: {
        "contracts/antfarm/AntfarmFactory.sol": { AntfarmFactory: ["abi", "evm.bytecode.object"] },
        "contracts/antfarm/AntfarmRouter.sol": { AntfarmRouter: ["abi", "evm.bytecode.object"] },
        "contracts/antfarm/AntfarmToken.sol": { AntfarmToken: ["abi", "evm.bytecode.object"] },
        [feeTokenPath]: { FeeToken: ["abi", "evm.bytecode.object"] },
        "contracts/antfarm/AntfarmAtfPair.sol": { AntfarmAtfPair: ["abi", "evm.bytecode.object"] },
      },
    },
  };
  const compiled = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (compiled.errors || []).filter((error) => error.severity === "error");
  assert.deepEqual(errors, [], errors.map((error) => error.formattedMessage).join("\n"));

  const chain = new ethers.BrowserProvider(ganache.provider({ logging: { quiet: true } }));
  const signer = await chain.getSigner();
  const user = await signer.getAddress();
  const deploy = async (path, name, args = []) => {
    const artifact = compiled.contracts[path][name];
    const factory = new ethers.ContractFactory(artifact.abi, `0x${artifact.evm.bytecode.object}`, signer);
    const contract = await factory.deploy(...args);
    await contract.waitForDeployment();
    return contract;
  };

  const atf = await deploy("contracts/antfarm/AntfarmToken.sol", "AntfarmToken");
  const inputToken = await deploy(feeTokenPath, "FeeToken");
  const factory = await deploy("contracts/antfarm/AntfarmFactory.sol", "AntfarmFactory", [await atf.getAddress()]);
  const router = await deploy("contracts/antfarm/AntfarmRouter.sol", "AntfarmRouter", [
    await factory.getAddress(), user, await atf.getAddress(),
  ]);
  await (await factory.createPair(await atf.getAddress(), await inputToken.getAddress(), 500)).wait();
  const pairAddress = await factory.getPair(await atf.getAddress(), await inputToken.getAddress(), 500);
  const pairArtifact = compiled.contracts["contracts/antfarm/AntfarmAtfPair.sol"].AntfarmAtfPair;
  const pair = new ethers.Contract(pairAddress, pairArtifact.abi, signer);

  await (await atf.transfer(pairAddress, ethers.parseEther("1000"))).wait();
  await (await inputToken.mint(user, 1000_000000)).wait();
  await (await inputToken.transfer(pairAddress, 1000_000000)).wait();
  await (await pair.mint(user, 1)).wait();
  await (await inputToken.mint(user, 100_000000)).wait();
  await (await inputToken.approve(await router.getAddress(), 100_000000)).wait();

  const maxFee = ethers.parseEther("1");
  const params = [
    100_000000,
    0,
    maxFee,
    [await inputToken.getAddress(), await atf.getAddress()],
    [500],
    user,
    Math.floor(Date.now() / 1000) + 1000,
  ];
  const supplyBefore = await atf.totalSupply();
  await (await router.swapExactTokensForTokensSupportingFeeOnTransferTokens(params, {
    gasLimit: 12_000_000,
  })).wait();

  const distributed = await pair.antfarmTokenReserve();
  const burned = supplyBefore - await atf.totalSupply();
  const actualFee = distributed + burned;
  const receivedInput = 90_000_000n;
  const routerEstimate = receivedInput * 500n / 1000n;

  assert(routerEstimate <= maxFee, "router estimate should be within the supplied fee cap");
  assert(actualFee > maxFee, "pair fee should exceed the supplied fee cap");
  console.log(JSON.stringify({
    routerEstimate: routerEstimate.toString(),
    maxFee: maxFee.toString(),
    pairFeeAccruedAndBurned: actualFee.toString(),
    capBypassed: true,
  }, null, 2));
  await chain.destroy();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
