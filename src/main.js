import '@agoric/install-ses';
import { spawn } from 'child_process';

import { openSwingStore } from '@agoric/swing-store-simple';
// import { runKeybaseBot } from './keybase';
import { runDiscordBot } from './discord';

const DEFAULT_NETWORK_NAME = 'testnet';
const VALID_NETWORK_NAMES = [DEFAULT_NETWORK_NAME, 'hacktheorb'];

const AG_SETUP_COSMOS = `${process.env.HOME}/ag-setup-cosmos`;

const q = obj => JSON.stringify(obj, null, 2);

const makeValidate = canProvision => async (request, TRIGGER_COMMAND) => {
  let cmdArgs;
  if (VALID_NETWORK_NAMES.includes(request.args[1])) {
    cmdArgs = request.args.slice(2);
  } else {
    cmdArgs = request.args.slice(1);
  }

  const [cmd, address] = cmdArgs;
  switch (cmd) {
    case 'client':
    case 'delegate':
    case 'add-egress':
    case 'add-delegate':
    case 'provision': {
      if (!address) {
        throw Error(`you need to provide an \`agoric1...\` address`);
      }
      if (!/^agoric1[a-z0-9]*$/.test(address)) {
        throw Error(`the address ${q(address)} must be \`agoric1...\``);
      }
      if (cmd === 'provision' && !canProvision) {
        throw Error(`${q(cmd)} not implemented`);
      }
      if (!request.sender.username) {
        throw Error(`need a sending username`);
      }
      break;
    }
    case 'help': {
      let help = '';
      if (canProvision) {
        help += `\
Give \`uagstake\` tokens to the specified address (something like \`agoric1wa9di7...\`):
\`\`\`
${TRIGGER_COMMAND} delegate <AGORIC-BECH32>
\`\`\`
`;
        help += `\
Add a client node (non-validator) to the network.  Do this only if prompted by your ag-solo client; this DOES NOT give you any tokens:
\`\`\`
${TRIGGER_COMMAND} client <AGORIC-BECH32>
\`\`\`
`;
      }
      return help;
    }
    case undefined: {
      throw Error(`\`${TRIGGER_COMMAND}\` needs an command`);
    }
    default: {
      throw Error(`${q(cmd)} not implemented`);
    }
  }
  return true;
};

const makeEnact = validate => {
  let baton = Promise.resolve();
  return async (request, TRIGGER_COMMAND) => {
    console.log('enacting', request);
    await validate(request, TRIGGER_COMMAND);
    const nextEnactment = () =>
      new Promise((resolve, reject) => {
        let NETWORK_NAME = DEFAULT_NETWORK_NAME;
        let cmdArgs;
        if (VALID_NETWORK_NAMES.includes(request.args[1])) {
          NETWORK_NAME = request.args[1];
          cmdArgs = request.args.slice(2);
        } else {
          cmdArgs = request.args.slice(1);
        }
        const [cmd, address] = cmdArgs;
        switch (cmd) {
          case 'client':
          case 'delegate':
          case 'add-egress':
          case 'add-delegate':
          case 'provision': {
            const command = [
              AG_SETUP_COSMOS,
              'shell',
              `${NETWORK_NAME}/faucet-helper.sh`,
              ['delegate', 'provision', 'add-delegate'].includes(cmd)
                ? 'add-delegate'
                : 'add-egress',
              request.sender.username,
              address,
            ];
            console.log('spawn', command, request);
            let buf = '';
            const cp = spawn(command[0], command.slice(1));
            cp.stdout.on('data', chunk => (buf += chunk.toString()));
            cp.stderr.on('data', chunk => (buf += chunk.toString()));
            cp.on('exit', code => {
              if (code) {
                const err = Error(
                  `Nonzero ${command.join(' ')} exit code: ${code}`,
                );
                err.priv = buf;
                reject(err);
              } else {
                resolve({ priv: buf, message: '' });
              }
            });
            cp.on('error', reject);
            break;
          }
          default:
            throw Error(`${cmd} not implemented`);
        }
      });

    // Don't actually run until the prior enactment is ready.
    baton = baton.then(nextEnactment, nextEnactment);
    return baton;
  };
};

export default async _argv => {
  const { storage, commit } = openSwingStore(`${__dirname}/../db`);

  const validate = makeValidate(true);
  const enact = makeEnact(validate);

  return Promise.all([
    // runKeybaseBot({ enact, validate, storage, commit }),
    runDiscordBot({ enact, validate, storage, commit }),
  ]);
};
