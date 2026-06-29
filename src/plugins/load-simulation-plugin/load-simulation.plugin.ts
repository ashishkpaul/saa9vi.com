import { VendurePlugin, PluginCommonModule } from "@vendure/core";
import { LoadSimulationService } from "./api/load-simulation.service";
import { LoadSimulationResolver } from "./api/load-simulation.resolver";
import { LoadOrchestrator } from "./engine/load-orchestrator";
import { GraphQLExecutor } from "./executor/graphql.executor";
import { VendureHttpClient } from "./executor/vendure-http.client";
import { adminApiExtensions } from "./api/api-extensions";

@VendurePlugin({
  imports: [PluginCommonModule],
  providers: [
    LoadSimulationService,
    LoadOrchestrator,
    GraphQLExecutor,
    {
      provide: VendureHttpClient,
      useFactory: () => {
        return new VendureHttpClient(
          process.env.SHOP_API_URL || "http://localhost:3000/shop-api",
          process.env.ADMIN_API_URL || "http://localhost:3000/admin-api",
          process.env.SHOP_API_TOKEN,
          process.env.ADMIN_API_TOKEN,
        );
      },
    },
  ],
  adminApiExtensions: {
    schema: adminApiExtensions,
    resolvers: [LoadSimulationResolver],
  },
})
export class LoadSimulationPlugin {}
