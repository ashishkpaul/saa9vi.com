import { Allow, Permission } from "@vendure/core";
import { Query, Resolver } from "@nestjs/graphql";
import { LoadSimulationService } from "./load-simulation.service";

@Resolver()
export class LoadSimulationResolver {
  constructor(private service: LoadSimulationService) {}

  @Allow(Permission.SuperAdmin)
  @Query()
  async runLoadTest(_: any, args: { profile: string }) {
    return this.service.run(args.profile);
  }
}
