import { Injectable } from "@nestjs/common";
import { VendureHttpClient } from "./vendure-http.client";

@Injectable()
export class GraphQLExecutor {
  constructor(private client: VendureHttpClient) {}

  async execute(
    query: string,
    variables: Record<string, unknown>,
    context: "shop" | "admin",
  ): Promise<{ latencyMs: number; success: boolean; data?: any; errors?: any[] }> {
    const start = performance.now();
    let raw: any;
    try {
      raw =
        context === "shop"
          ? await this.client.executeShop(query, variables)
          : await this.client.executeAdmin(query, variables);
    } catch (err) {
      return {
        latencyMs: performance.now() - start,
        success: false,
        errors: [{ message: err instanceof Error ? err.message : String(err) }],
      };
    }

    const success = !raw?.errors;
    return {
      latencyMs: performance.now() - start,
      success,
      data: raw?.data,
      errors: raw?.errors,
    };
  }
}
