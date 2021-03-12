// @ts-check
import Discord from 'discord.js';
import { assert, details } from '@agoric/assert';

const TRIGGER_COMMAND = '!faucet';
const ADMIN_CHANNEL = ['Internal', 'bot-control'];
const SERVER_NAME = 'Agoric';

export const runDiscordBot = opts =>
  new Promise((resolve, reject) => {
    console.log('Initializing Discord bot...');

    const withReject = fn => (...args) => {
      return Promise.resolve()
        .then(_ => fn(...args))
        .catch(reject);
    };

    /** @type {Discord.TextChannel} */
    let adminChannel;
    const { enact, validate, _storage, _commit } = opts;

    const bot = new Discord.Client();
    bot.login(process.env.DISCORD_FAUCET_TOKEN);

    /**
     *
     * @param {Discord.Message} msg
     * @param {Array<string>} args
     */
    const handleFaucetCommand = async (msg, args) => {
      const username = msg.author.id;
      const request = {
        args,
        sender: { username },
      };
      const help = await validate(request, TRIGGER_COMMAND).catch(async e => {
        await msg.reply(
          `\`${e}\`; try \`${TRIGGER_COMMAND} help\` for more information`,
        );
        return false;
      });
      if (help === false) {
        return;
      }
      if (typeof help === 'string') {
        await msg.reply(`\
${help}Display this help:
\`\`\`
${TRIGGER_COMMAND} help
\`\`\`
NOTE: 🤔 means that your request is still waiting manual approval.
`);
        return;
      }

      // TODO: Check the request before submitting to admins.
      const hourglass = await msg.react('⏳');
      enact(request, TRIGGER_COMMAND)
        .then(
          async ({ pub, priv }) => {
            await msg.react('✅');
            const body = `${msg.author} did \`${args.join(' ')}\`.`;
            let reply = `${body}\n\`\`\`\n${priv}\`\`\``;
            if (pub) {
              reply = `${pub}\n${reply}`;
              await msg.reply(pub);
            }
            await adminChannel.send(reply);
          },
          async e => {
            await msg.react('☠️');
            const body = `${msg.author} failed to \`${args.join(' ')}\`.`;
            const reply = `${body}\n\`\`\`\n${(e && e.priv) || ''}${e}\`\`\``;
            await adminChannel.send(reply);
          },
        )
        .finally(async () => {
          await hourglass
            .remove()
            .catch(e => console.error('Cannot remove hourglass', e));
        });
    };

    bot.on(
      'ready',
      withReject(async () => {
        const server = bot.guilds.cache.find(srv => srv.name === SERVER_NAME);
        assert(server, details`Cannot fetch server/guild ${SERVER_NAME}`);
        const channel = server.channels.cache.find(ch => {
          if ((ch.parent && ch.parent.name) !== ADMIN_CHANNEL[0]) {
            return false;
          }
          return ch.name === ADMIN_CHANNEL[1];
        });
        assert(channel, details`Cannot fetch ${ADMIN_CHANNEL.join(' ')}`);
        assert.equal(
          channel.type,
          'text',
          details`Channel ${channel.id} is not a text channel`,
        );
        adminChannel = /** @type {Discord.TextChannel} */ (channel);
        console.log('Discord bot initialized');
      }),
    );

    bot.on(
      'error',
      withReject(async e => {
        console.error('Discord bot error', e);
        throw e;
      }),
    );

    bot.on('message', msg => {
      const args = msg.content.split('\n')[0].trim().split(/\s+/);
      if (args[0] === TRIGGER_COMMAND) {
        handleFaucetCommand(msg, args);
      }
    });
  });
