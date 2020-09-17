import KeybaseBot from 'keybase-bot';

const TRIGGER_COMMAND = '!faucet';

const ADMIN_CHANNEL = {
  name: 'agoric.testnet.admins',
  membersType: 'team',
  topicType: 'chat',
  topicName: 'general',
};

export const runKeybaseBot = async ({ enact, validate, storage, commit }) => {
  console.log('Initializing Keybase bot...');
  const bot = new KeybaseBot();
  await bot.initFromRunningService();
  console.log('Keybase bot initialized');

  const handleFaucetCommand = async (requestMsg, args) => {
    // console.log('checking', args);
    const request = { ...requestMsg, args };
    const help = await validate(request, TRIGGER_COMMAND).catch(async e => {
      await bot.chat.send(
        requestMsg.conversationId,
        {
          body: `${e}; try \`${TRIGGER_COMMAND} help\` for more information`,
        },
        { replyTo: requestMsg.id },
      );
      return false;
    });
    if (help === false) {
      return;
    }
    if (typeof help === 'string') {
      await bot.chat.send(
        requestMsg.conversationId,
        {
          body: `\
${help}\`\`\`
${TRIGGER_COMMAND} help
\`\`\`
display this help
`,
        },
        { replyTo: requestMsg.id },
      );
      return;
    }

    const thinking = await bot.chat.react(
      requestMsg.conversationId,
      requestMsg.id,
      ':thinking_face:',
    );

    const body = `\
@here @${requestMsg.sender.username} wants to \`${args.join(' ')}\`.`;
    // React with :+1: or :-1:`;
    const question = await bot.chat.send(ADMIN_CHANNEL, { body });
    // console.log('sent out', approval);

    storage.set(
      `pending/${question.id}`,
      JSON.stringify({
        request,
        msg: requestMsg,
        thinking,
        question: { conversationId: ADMIN_CHANNEL, ...question },
      }),
    );
    commit();
  };

  const onMessage = async msg => {
    console.log('have message', msg);
    switch (msg.content.type) {
      case 'reaction': {
        // console.log('handling reaction', msg);
        if (msg.channel.name !== ADMIN_CHANNEL.name) {
          return;
        }
        const approveMsg = msg;
        let approve;
        if (approveMsg.content.reaction.b === ':-1:') {
          approve = false;
        } else if (approveMsg.content.reaction.b === ':+1:') {
          approve = true;
        } else {
          return;
        }
        // Look up the pending approval from the reacted-to message.
        const pendingKey = `pending/${approveMsg.content.reaction.m}`;
        const pending = storage.get(pendingKey);
        if (!pending) {
          return;
        }
        // Dig out the request and the original request message.
        const { request, msg: requestMsg, thinking, question } = JSON.parse(
          pending,
        );

        // Mark as no longer pending.
        storage.delete(pendingKey);
        commit();

        // Tell them the reaction.
        // console.log('telling', approveMsg.content.reaction.b);
        await bot.chat.react(
          requestMsg.conversationId,
          requestMsg.id,
          approveMsg.content.reaction.b,
        );

        await bot.chat
          .delete(requestMsg.conversationId, thinking.id)
          .catch(_ => {});
        if (!approve) {
          // Denied, so don't do anything.
          return;
        }

        // Try to enact the approval.
        const hourglass = await bot.chat.react(
          requestMsg.conversationId,
          requestMsg.id,
          ':hourglass_flowing_sand:',
        );
        await enact(request, TRIGGER_COMMAND)
          .then(
            async body => {
              await bot.chat.react(
                requestMsg.conversationId,
                requestMsg.id,
                ':white_check_mark:',
              );
              if (!body) {
                return;
              }
              await bot.chat.send(
                question.conversationId,
                {
                  body,
                },
                { replyTo: question.id },
              );
              await bot.chat.send(
                requestMsg.conversationId,
                {
                  body,
                },
                { replyTo: requestMsg.id },
              );
            },
            async e => {
              await bot.chat.send(
                question.conversationId,
                {
                  body: `\
Failed!
\`\`\`
${(e && e.stack) || e}
\`\`\``,
                },
                { replyTo: question.id },
              );
              await bot.chat.react(
                requestMsg.conversationId,
                requestMsg.id,
                ':skull_and_crossbones:',
              );
            },
          )
          .finally(() => {
            return bot.chat.delete(requestMsg.conversationId, hourglass.id);
          });
        break;
      }
      case 'text': {
        const args = msg.content.text.body.trim().split(/\s+/);
        if (args[0] === TRIGGER_COMMAND) {
          // console.log('handling', msg);
          await handleFaucetCommand(msg, args);
        }
        break;
      }
      default:
      // console.log('have other message', msg);
    }
  };

  // Start watching for new messages.
  const watchingP = bot.chat.watchAllChannelsForNewMessages(
    onMessage,
    undefined,
    { showLocal: true },
  );

  const readNextPage = async (channel, pageNum = undefined) => {
    const res = await bot.chat.read(channel.id, {
      peek: true,
      unreadOnly: true,
      pagination: {
        next: pageNum,
      },
    });
    for (const msg of res.messages) {
      // eslint-disable-next-line no-await-in-loop
      await onMessage(msg);
    }
    if (!res.pagination.last) {
      await readNextPage(channel, res.pagination.next);
    }
  };

  // Find and process all our unread messages.
  const unreadChannels = await bot.chat.list({ unreadOnly: true });
  await Promise.all(unreadChannels.map(channel => readNextPage(channel)));

  await watchingP;
};
