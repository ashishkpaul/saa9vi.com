import { Query, Resolver } from "@nestjs/graphql";
import { LoadSimulationService } from "./load-simulation.service";

@Resolver()
export class LoadSimulationResolver {
  constructor(private service: LoadSimulationService) {}

  @Query()
  async runLoadTest(_: any, args: { profile: string }) {
    return this.service.run(args.profile);
  }
}
