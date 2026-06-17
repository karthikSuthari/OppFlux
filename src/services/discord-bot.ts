import {
    Client,
    GatewayIntentBits
} from 'discord.js';

import { config } from '../config/env.js';

export const discordClient = new Client({

    intents: [

        GatewayIntentBits.Guilds,

        GatewayIntentBits.GuildMessages,

        GatewayIntentBits.GuildMessageReactions,

        GatewayIntentBits.MessageContent

    ]

});


discordClient.once('ready', () => {

    console.log('══════════════════════');
    console.log('Discord Bot Ready');
    console.log(discordClient.user?.tag);
    console.log('══════════════════════');

});


discordClient.on('error', (err) => {
    console.log(err);
});


discordClient.login(config.discordBotToken);