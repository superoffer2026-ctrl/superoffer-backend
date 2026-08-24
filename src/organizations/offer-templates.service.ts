import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Organization, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface OfferTemplateInput {
  name: string;
  description?: string;
  terms?: Record<string, unknown>;
  value?: string;
  valueLabel?: string;
  conditions?: string;
  nextSteps?: string[];
  responseWindowDays?: number;
  isDefault?: boolean;
}

/**
 * The offers a product is prepared to make.
 *
 * Terms are written here once rather than typed into every invitation. That is
 * what makes a one-click invitation safe: an officer picking a product is
 * picking terms the organisation already agreed to, not composing new ones
 * under time pressure.
 */
@Injectable()
export class OfferTemplatesService {
  constructor(private prisma: PrismaService) {}

  /** Refuses to read or write a product belonging to somebody else. */
  private async ownedProduct(organization: Organization, productId: string) {
    const product = await this.prisma.organizationProduct.findFirst({
      where: { id: productId, organizationId: organization.id }
    });
    if (!product) {
      throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND', message: 'No such product' });
    }
    return product;
  }

  async list(organization: Organization, productId: string) {
    await this.ownedProduct(organization, productId);
    const templates = await this.prisma.offerTemplate.findMany({
      where: { productId, archivedAt: null },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }]
    });
    return { templates };
  }

  /** Every template this organisation has, grouped by the product it belongs to. */
  async listAll(organization: Organization) {
    const templates = await this.prisma.offerTemplate.findMany({
      where: { organizationId: organization.id, archivedAt: null },
      include: { product: { select: { id: true, name: true, category: true } } },
      orderBy: [{ productId: 'asc' }, { isDefault: 'desc' }]
    });
    return { templates };
  }

  async create(organization: Organization, productId: string, input: OfferTemplateInput) {
    const product = await this.ownedProduct(organization, productId);
    if (!input.name?.trim()) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Give the template a name' });
    }

    const existing = await this.prisma.offerTemplate.count({ where: { productId, archivedAt: null } });
    /**
     * The first template a product gets is always its default, whatever the form
     * says — a product with templates and no default cannot be invited with one
     * click, which is the point of having them.
     */
    const isDefault = existing === 0 ? true : Boolean(input.isDefault);

    if (isDefault) await this.clearDefault(productId);

    const template = await this.prisma.offerTemplate.create({
      data: {
        productId,
        organizationId: organization.id,
        name: input.name.trim(),
        description: input.description,
        terms: (input.terms ?? {}) as Prisma.InputJsonValue,
        value: input.value,
        valueLabel: input.valueLabel ?? (product.category === 'Financial Product' ? 'Loan amount' : 'Scholarship'),
        conditions: input.conditions,
        nextSteps: input.nextSteps ?? [],
        responseWindowDays: input.responseWindowDays,
        isDefault
      }
    });
    return template;
  }

  async update(organization: Organization, id: string, input: Partial<OfferTemplateInput>) {
    const existing = await this.prisma.offerTemplate.findFirst({
      where: { id, organizationId: organization.id, archivedAt: null }
    });
    if (!existing) throw new NotFoundException({ code: 'TEMPLATE_NOT_FOUND', message: 'No such template' });

    if (input.isDefault) await this.clearDefault(existing.productId);

    return this.prisma.offerTemplate.update({
      where: { id },
      data: {
        name: input.name?.trim() ?? existing.name,
        description: input.description ?? existing.description,
        terms: (input.terms ?? (existing.terms as Prisma.InputJsonValue)) as Prisma.InputJsonValue,
        value: input.value ?? existing.value,
        valueLabel: input.valueLabel ?? existing.valueLabel,
        conditions: input.conditions ?? existing.conditions,
        nextSteps: input.nextSteps ?? existing.nextSteps,
        responseWindowDays: input.responseWindowDays ?? existing.responseWindowDays,
        isDefault: input.isDefault ?? existing.isDefault
      }
    });
  }

  /**
   * Archived rather than deleted, because offers already sent on it point here
   * and "which template did this come from" should still have an answer.
   */
  async archive(organization: Organization, id: string) {
    const existing = await this.prisma.offerTemplate.findFirst({
      where: { id, organizationId: organization.id, archivedAt: null }
    });
    if (!existing) throw new NotFoundException({ code: 'TEMPLATE_NOT_FOUND', message: 'No such template' });

    await this.prisma.offerTemplate.update({ where: { id }, data: { archivedAt: new Date(), isDefault: false } });

    /** A product without a default cannot be one-click invited, so promote another. */
    if (existing.isDefault) {
      const next = await this.prisma.offerTemplate.findFirst({
        where: { productId: existing.productId, archivedAt: null },
        orderBy: { createdAt: 'asc' }
      });
      if (next) await this.prisma.offerTemplate.update({ where: { id: next.id }, data: { isDefault: true } });
    }

    return { archived: true };
  }

  private clearDefault(productId: string) {
    return this.prisma.offerTemplate.updateMany({
      where: { productId, isDefault: true },
      data: { isDefault: false }
    });
  }

  /**
   * The template a one-click invitation would send for this product.
   *
   * Named rather than inferred: an officer clicking once is trusting that the
   * answer is knowable, so a product with no template says so instead of
   * inventing terms.
   */
  async defaultFor(organization: Organization, productId: string) {
    await this.ownedProduct(organization, productId);
    const template = await this.prisma.offerTemplate.findFirst({
      where: { productId, archivedAt: null, isDefault: true }
    });
    if (!template) {
      throw new BadRequestException({
        code: 'NO_DEFAULT_TEMPLATE',
        message: 'This product has no offer template yet. Add one before inviting with a single click.'
      });
    }
    return template;
  }
}
