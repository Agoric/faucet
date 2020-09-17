import { spawn } from 'child_process';

import { openSwingStore } from '@agoric/swing-store-simple';
import { runKeybaseBot } from './keybase';

const NETWORK_NAME = 'testnet';
const AG_SETUP_COSMOS = `${process.env.HOME}/ag-setup-cosmos`;

const q = obj => JSON.stringify(obj, null, 2);

const makeValidate = canProvision => async (request, TRIGGER_COMMAND) => {
  const [_trigger, cmd, address] = request.args;
  switch (cmd) {
    case 'add-egress':
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
      return `\
\`\`\`
${TRIGGER_COMMAND} provision <AGORIC-BECH32>
\`\`\`
give delegation tokens to the specified address (something like \`agoric1wa9di7...\`)`;
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
      case 'add-egress':
      case 'provision': {
        const command = [
          AG_SETUP_COSMOS,
          'shell',
          `${NETWORK_NAME}/faucet-helper.sh`,
          cmd,
          request.sender.username,
          address,
        ];
        console.log('spawn', command, request);
        const cp = spawn(command[0], command.slice(1));
        cp.on('exit', resolve);
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

  return Promise.all([runKeybaseBot({ enact, validate, storage, commit })]);
};
