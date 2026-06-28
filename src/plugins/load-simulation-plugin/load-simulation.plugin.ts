import { VendurePlugin, PluginCommonModule } from "@vendure/core";
import { LoadSimulationService } from "./api/load-simulation.service";
import { LoadSimulationResolver } from "./api/load-simulation.resolver";

@VendurePlugin({
  imports: [PluginCommonModule],
  providers: [LoadSimulationService],
  shopApiExtensions: {
    resolvers: [LoadSimulationResolver],
  },
})
export class LoadSimulationPlugin {}
