import { Client } from "../client";
import { searchEndpoint } from "../../client/endpoints";

interface SearchResult {
  title: string;
  link: string;
  snippet: string;
  date: string;
}

export interface SearchResponse {
  organic: SearchResult[];
}

export class SearchSDK extends Client {
  async query(query: string): Promise<SearchResponse> {
    const url = searchEndpoint(this.config.baseUrl);
    const res = await this.requestJson<SearchResponse>({
      url,
      method: 'POST',
      body: { q: query },
    });

    return res;
  }
}
