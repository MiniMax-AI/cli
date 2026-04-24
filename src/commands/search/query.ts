import { defineCommand } from '../../command';
import { requestJson } from '../../client/http';
import { searchEndpoint } from '../../client/endpoints';
import { formatOutput, detectOutputFormat } from '../../output/formatter';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';
import type { Config } from '../../config/schema';
import type { GlobalFlags } from '../../types/flags';

interface SearchResult {
  title: string;
  link: string;
  snippet: string;
  date: string;
}

interface SearchResponse {
  organic: SearchResult[];
}

export default defineCommand({
  name: 'search query',
  description: 'Search the web via MiniMax',
  usage: 'mmx search query --q <query>',
  options: [
    { flag: '--q <query>', description: 'Search query string' },
  ],
  examples: [
    'mmx search query --q "MiniMax AI"',
    'mmx search query --q "latest news" --output json',
  ],
  async run(config: Config, flags: GlobalFlags) {
    const query = (flags.q ?? flags.query ?? (flags._positional as string[]|undefined)?.[0]) as string | undefined;

    if (!query) {
      throw new CLIError(
        '--q is required.',
        ExitCode.USAGE,
        'mmx search query --q "your search query"',
      );
    }

    const format = detectOutputFormat(config.output);

    if (config.dryRun) {
      console.log(formatOutput({ request: { q: query } }, format));
      return;
    }

    const url = searchEndpoint(config.baseUrl);
    const response = await requestJson<SearchResponse>(config, {
      url,
      method: 'POST',
      body: { q: query },
    });

    const results = response.organic || [];

    if (format !== 'text') {
      console.log(formatOutput(response, format));
      return;
    }

    if (config.quiet) {
      for (const r of results) {
        console.log(`${r.title}\t${r.link}`);
      }
      return;
    }

    if (results.length === 0) {
      console.log('No results found.');
      return;
    }

    for (const r of results) {
      console.log(`${r.title}`);
      console.log(`  ${r.link}`);
      if (r.snippet) console.log(`  ${r.snippet}`);
      if (r.date) console.log(`  ${r.date}`);
      console.log('');
    }
  },
});
