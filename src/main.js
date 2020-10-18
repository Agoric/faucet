import '@agoric/install-ses';
import { spawn } from 'child_process';

import { openSwingStore } from '@agoric/swing-store-simple';
import { runKeybaseBot } from './keybase';
import { runDiscordBot } from './discord';

const NETWORK_NAME = 'testnet';
const AG_SETUP_COSMOS = `${process.env.HOME}/ag-setup-cosmos`;

const q = obj => JSON.stringify(obj, null, 2);

const makeValidate = canProvision => async (request, TRIGGER_COMMAND) => {
  const [_trigger, cmd, address] = request.args;
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
      let help = `\
Add an Agoric Wallet to the network (something like \`agoric1wa9di7...\`):
\`\`\`
${TRIGGER_COMMAND} client <AGORIC-BECH32>
\`\`\`
`;
      if (canProvision) {
        help += `\
Give \`uagstake\` tokens to the specified address (something like \`agoric1wa9di7...\`):
\`\`\`
${TRIGGER_COMMAND} delegate <AGORIC-BECH32>
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

const makeEnact = validate => async (request, TRIGGER_COMMAND) => {
  console.log('enacting', request);
  await validate(request, TRIGGER_COMMAND);
  return new Promise((resolve, reject) => {
    const [_trigger, cmd, address] = request.args;
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
