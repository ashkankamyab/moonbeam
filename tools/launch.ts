import minimist from "minimist";
import * as fs from "fs";
import * as path from "path";
import * as child_process from "child_process";
import { killAll, run } from "polkadot-launch";

// Description of the network to launch
type NetworkConfig = {
  // From which docker to take the binary
  docker?: string;
  // To use instead of docker to run local binary
  binary?: string;
  // What runtime to run
  runtime: string;
};

// Description of the parachain network
type ParachainConfig = NetworkConfig & {
  // Which relay (name) config to use
  relay: string;
};

const parachains: { [name: string]: ParachainConfig } = {
  "moonriver-v47": {
    relay: "kusama-v9030",
    runtime: "moonriver-local",
    docker: "purestake/moonbeam:moonriver-genesis",
  },
  "moonriver-v47-fast": {
    relay: "kusama-v9030-fast",
    runtime: "moonriver-local",
    docker: "purestake/moonbase-parachain:moonriver-genesis-fast",
  },
  "alphanet-v8.1": {
    relay: "rococo-9003",
    runtime: "moonbase-local",
    docker: "purestake/moonbeam:v0.8.1",
  },
  "moonriver-local": {
    relay: "kusama-v9030",
    runtime: "moonriver-local",
    binary: "../target/release/moonbeam",
  },
};
const parachainNames = Object.keys(parachains);

const relays: { [name: string]: NetworkConfig } = {
  "kusama-v9030": {
    docker: "purestake/moonbase-relay-testnet:sha-aa386760",
    runtime: "kusama-local",
  },
  "kusama-v9030-fast": {
    docker: "purestake/moonbase-relay-testnet:kusama-v0.9.3-fast",
    runtime: "kusama-local",
  },
  "rococo-9003": {
    docker: "purestake/moonbase-relay-testnet:sha-aa386760",
    runtime: "rococo-local",
  },
  "rococo-local": {
    binary: "../../polkadot/target/release/polkadot",
    runtime: "rococo-local",
  },
};
const relayNames = Object.keys(relays);

function start() {
  const argv = minimist(process.argv.slice(2));

  if (argv._.length != 1) {
    console.error(`Invalid arguments (expected: 1, got: ${argv._.length})`);
    console.error(
      `Usage: ts-node launch.ts <${parachainNames.join(
        "|"
      )}> [--parachain-id 1000] [--relay <${relayNames.join("|")}>]`
    );
    return;
  }
  if (!parachainNames.includes(argv._[0])) {
    console.error(`Invalid parachain name: ${argv._[0]}`);
    console.error(`Expected one of: ${parachainNames.join(", ")}`);
    return;
  }

  const parachainName = argv._[0];
  const parachain = parachains[parachainName];

  const relayName = argv.relay || parachain.relay;

  if (!relayName || !relayNames.includes(relayName)) {
    console.error(`Invalid relay name: ${relayName}`);
    console.error(`Expected one of: ${relayNames.join(", ")}`);
    return;
  }

  const relay = relays[relayName];

  console.log(
    `🚀     Relay: ${relayName.padEnd(20)} - ${relay.docker || relay.binary} (${relay.runtime})`
  );

  let parachainBinary;
  if (parachain.binary) {
    parachainBinary = parachain.binary;
    const parachainPath = path.join(__dirname, parachain.binary);
    if (!fs.existsSync(parachainPath)) {
      console.log(`     Missing ${parachainPath}`);
      return;
    }
  } else {
    parachainBinary = `build/${parachainName}/moonbeam`;
    const parachainPath = path.join(__dirname, `build/${parachainName}/moonbeam`);
    if (!fs.existsSync(parachainPath)) {
      console.log(`     Missing ${parachainBinary} locally, downloading it...`);
      child_process.execSync(`mkdir -p ${path.dirname(parachainPath)} && \
          docker create --name moonbeam-tmp ${parachain.docker} && \
          docker cp moonbeam-tmp:/moonbeam/moonbeam ${parachainPath} && \
          docker rm moonbeam-tmp`);
      console.log(`     ${parachainBinary} downloaded !`);
    }
  }
  console.log(
    `🚀 Parachain: ${parachainName.padEnd(20)} - ${parachain.docker || parachain.binary} (${
      parachain.runtime
    })`
  );

  let relayBinary;
  if (relay.binary) {
    relayBinary = relay.binary;
    const relayPath = path.join(__dirname, relay.binary);
    if (!fs.existsSync(relayPath)) {
      console.log(`     Missing ${relayPath}`);
      return;
    }
  } else {
    relayBinary = `build/${relayName}/polkadot`;
    const relayPath = path.join(__dirname, `build/${relayName}/polkadot`);
    if (!fs.existsSync(relayPath)) {
      console.log(`     Missing ${relayBinary} locally, downloading it...`);
      child_process.execSync(`mkdir -p ${path.dirname(relayPath)} && \
          docker create --name polkadot-tmp ${relay.docker} && \
          docker cp polkadot-tmp:/usr/local/bin/polkadot ${relayPath} && \
          docker rm polkadot-tmp`);
      console.log(`     ${relayBinary} downloaded !`);
    }
  }
  console.log("");

  let launchConfig = launchTemplate;
  launchConfig.relaychain.bin = relayBinary;
  launchConfig.relaychain.chain = relay.runtime;
  launchConfig.parachains[0].bin = parachainBinary;
  launchConfig.parachains[0].chain = parachain.runtime;

  launchConfig.parachains[0].id = argv["parachain-id"] || 1000;

  // Kill all processes when exiting.
  process.on("exit", function () {
    killAll();
  });

  // Handle ctrl+c to trigger `exit`.
  process.on("SIGINT", function () {
    process.exit(2);
  });

  run(__dirname, launchConfig);
}

const launchTemplate = {
  relaychain: {
    bin: "...",
    chain: "...",
    nodes: [
      {
        name: "alice",
        wsPort: 39944,
        port: 39444,
      },
      {
        name: "bob",
        wsPort: 39955,
        port: 39555,
      },
    ],
    runtime_genesis_config: {
      parachainsConfiguration: {
        config: {
          validation_upgrade_frequency: 1,
          validation_upgrade_delay: 1,
        },
      },
    },
  },
  parachains: [
    {
      bin: "...",
      id: "...",
      balance: "1000000000000000000000",
      chain: "...",
      nodes: [
        {
          rpcPort: 36846,
          wsPort: 36946,
          port: 36336,
          flags: [
            "--log=info,rpc=trace,evm=trace,ethereum=trace",
            "--rpc-port=36846",
            "--unsafe-rpc-external",
            "--alice",
            "--rpc-cors=all",
            "--",
            "--execution=wasm",
          ],
        },
        {
          rpcPort: 36847,
          wsPort: 36947,
          port: 36337,
          flags: [
            "--log=info,rpc=trace,evm=trace,ethereum=trace",
            "--rpc-port=36847",
            "--charlie",
            "--unsafe-rpc-external",
            "--rpc-cors=all",
            "--",
            "--execution=wasm",
          ],
        },
      ],
    },
  ],
  simpleParachains: [],
  hrmpChannels: [],
  types: {
    Address: "MultiAddress",
    LookupSource: "MultiAddress",
    RoundIndex: "u32",
  },
  finalization: true,
};

start();