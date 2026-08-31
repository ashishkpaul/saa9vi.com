import { Injectable, Logger } from "@nestjs/common";
import { ID, ListQueryBuilder, RequestContext, TransactionalConnection } from "@vendure/core";
import { NavigationMenu, NavigationMenuItem } from "../entities/navigation-menu.entity";
import { loggerCtx } from "../constants";

export interface CreateNavigationMenuInput {
    name: string;
    items?: NavigationMenuItem[];
    isActive?: boolean;
    channelId: string;
}

export interface UpdateNavigationMenuInput {
    id: ID;
    name?: string;
    items?: NavigationMenuItem[];
    isActive?: boolean;
}

/**
 * CRUD service for NavigationMenu entities.
 *
 * One menu per channel (unique channelId). Used by the storefront to
 * render navigation bars.
 */
@Injectable()
export class NavigationMenuService {
    private readonly logger = new Logger(loggerCtx);

    constructor(
        private readonly connection: TransactionalConnection,
        private readonly listBuilder: ListQueryBuilder,
    ) {}

    async findAll(ctx: RequestContext): Promise<NavigationMenu[]> {
        return this.listBuilder
            .build(NavigationMenu, {}, { ctx })
            .orderBy("createdAt", "DESC")
            .getMany();
    }

    async findOne(ctx: RequestContext, id: ID): Promise<NavigationMenu | null> {
        return this.connection.getRepository(ctx, NavigationMenu).findOne({ where: { id } });
    }

    async findOneByChannel(ctx: RequestContext, channelId: string): Promise<NavigationMenu | null> {
        return this.connection
            .getRepository(ctx, NavigationMenu)
            .findOne({ where: { channelId } });
    }

    async create(ctx: RequestContext, input: CreateNavigationMenuInput): Promise<NavigationMenu> {
        const repo = this.connection.getRepository(ctx, NavigationMenu);
        const existing = await repo.findOne({ where: { channelId: input.channelId } });
        if (existing) {
            throw new Error(`NavigationMenu already exists for channel ${input.channelId}`);
        }
        const menu = await repo.save(
            repo.create({
                name: input.name,
                items: input.items ?? [],
                isActive: input.isActive ?? true,
                channelId: input.channelId,
            }),
        );
        this.logger.log(`Created NavigationMenu '${menu.name}' for channel ${input.channelId}`, loggerCtx);
        return menu;
    }

    async update(ctx: RequestContext, input: UpdateNavigationMenuInput): Promise<NavigationMenu> {
        const repo = this.connection.getRepository(ctx, NavigationMenu);
        const menu = await repo.findOne({ where: { id: input.id } });
        if (!menu) {
            throw new Error(`NavigationMenu ${input.id} not found`);
        }
        if (input.name !== undefined) menu.name = input.name;
        if (input.items !== undefined) menu.items = input.items;
        if (input.isActive !== undefined) menu.isActive = input.isActive;
        const saved = await repo.save(menu);
        this.logger.log(`Updated NavigationMenu '${saved.name}' (${saved.id})`, loggerCtx);
        return saved;
    }

    async remove(ctx: RequestContext, id: ID): Promise<boolean> {
        const repo = this.connection.getRepository(ctx, NavigationMenu);
        const result = await repo.delete({ id });
        return (result.affected ?? 0) > 0;
    }
}
