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
`);
        return;
      }

      // TODO: Check the request before submitting to admins.
      const thinking = await msg.react('🤔');

      const body = `\
@everyone ${msg.author} wants to \`${args.join(' ')}\`.`;
      // React with :+1: or :-1:
      const question = await adminChannel.send(body);
      const collector = await question.createReactionCollector(
        (_reaction, _user) => true,
      );

      collector.on('collect', async (reaction, _user) => {
        if (reaction.emoji.name === '👎') {
          collector.stop();
          msg.react(reaction.emoji);
        } else if (reaction.emoji.name === '👍') {
          collector.stop();
          const hourglass = await msg.react('⏳');
          await thinking
            .remove()
            .catch(e => console.error('Cannot remove thinking', e));
          enact(request, TRIGGER_COMMAND)
            .then(
              async ({ message, priv }) => {
                await msg.react('✅');
                let reply = `\`\`\`\n${priv}\`\`\``;
                if (message) {
                  reply = `${message}\n${reply}`;
                }
                await question.reply(reply);
                if (!message) {
                  return;
                }
                await msg.channel.send(`${msg.author} ${message}`);
                await msg.react(reaction.emoji);
              },
              async e => {
                await msg.react('☠️');
                await question.channel.send(`\
${msg.author} Failed!
\`\`\`
${(e && e.priv) || ''}${(e && e.stack) || e}
\`\`\``);
              },
            )
            .finally(async () => {
              await hourglass
                .remove()
                .catch(e => console.error('Cannot remove hourglass', e));
            });
        }
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
