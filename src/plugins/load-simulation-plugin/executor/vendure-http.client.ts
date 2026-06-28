export class VendureHttpClient {
  constructor(
    private shopApiUrl: string,
    private adminApiUrl: string,
    private shopToken?: string,
    private adminToken?: string,
  ) {}

  async executeShop(query: string, variables: Record<string, unknown>) {
    return this.execute(this.shopApiUrl, query, variables, this.shopToken);
  }

  async executeAdmin(query: string, variables: Record<string, unknown>) {
    return this.execute(this.adminApiUrl, query, variables, this.adminToken);
  }

  private async execute(
    url: string,
    query: string,
    variables: Record<string, unknown>,
    token?: string,
  ): Promise<any> {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ query, variables }),
    });

    return res.json();
  }
}
