import { Global, Module } from "@nestjs/common";
import { PluginCommonModule } from "@vendure/core";
import { CustomerDeletionService } from "./customer-deletion.service";

/**
 * Platform module for customer deletion orchestration.
 *
 * Provides CustomerDeletionService which coordinates across all plugins
 * during Flow A (leave_channel) and Flow B (full_delete).
 *
 * Each plugin registers its own deletion handler via
 * CustomerDeletionService.registerChannelScopedHandler() and
 * CustomerDeletionService.registerFullDeleteHandler() during its module init.
 *
 * PluginCommonModule is required to resolve TransactionalConnection,
 * CustomerService, and UserService in the Vendure DI context.
 */
@Global()
@Module({
  imports: [PluginCommonModule],
  providers: [CustomerDeletionService],
  exports: [CustomerDeletionService],
})
export class CustomerDeletionModule {}
