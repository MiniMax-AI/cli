import pkg from '../package.json' with { type: 'json' };

export const CLI_VERSION = process.env.CLI_VERSION ?? pkg.version;
