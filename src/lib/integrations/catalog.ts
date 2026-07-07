/**
 * Camada de integração de catálogo/pedidos com ERPs e lojas virtuais.
 *
 * Mesmo padrão de `src/lib/whatsapp.ts`: o CRM fala apenas com a interface
 * `CatalogSyncProvider`. Bling, Nuvemshop e Shopify entram implementando
 * essa interface — nenhuma tela ou rota muda.
 *
 * Nada aqui está implementado ainda (propositalmente): são os contratos
 * que as integrações futuras deverão cumprir.
 */

export type ExternalProduct = {
  externalId: string;
  name: string;
  sku: string;
  price: number;
  stock: number;
};

export type ExternalOrderStatus =
  | "pending"
  | "paid"
  | "shipped"
  | "delivered"
  | "cancelled";

export interface CatalogSyncProvider {
  readonly name: string;
  readonly configured: boolean;

  /** Importa produtos do sistema externo para o catálogo do CRM. */
  pullProducts(): Promise<ExternalProduct[]>;

  /** Publica/atualiza um produto do CRM no sistema externo. */
  pushProduct(productId: string): Promise<{ externalId: string }>;

  /** Envia um pedido fechado no CRM para faturamento no ERP. */
  pushOrder(orderId: string): Promise<{ externalId: string }>;

  /** Atualiza o estoque local a partir do sistema externo. */
  syncStock(): Promise<{ updated: number }>;
}

class NotConfiguredProvider implements CatalogSyncProvider {
  readonly configured = false;
  constructor(readonly name: string) {}

  private fail(): never {
    throw new Error(
      `Integração ${this.name} ainda não configurada. Conecte em Configurações → Integrações.`
    );
  }
  pullProducts(): Promise<ExternalProduct[]> {
    this.fail();
  }
  pushProduct(): Promise<{ externalId: string }> {
    this.fail();
  }
  pushOrder(): Promise<{ externalId: string }> {
    this.fail();
  }
  syncStock(): Promise<{ updated: number }> {
    this.fail();
  }
}

export const blingProvider: CatalogSyncProvider = new NotConfiguredProvider("Bling");
export const nuvemshopProvider: CatalogSyncProvider = new NotConfiguredProvider("Nuvemshop");
export const shopifyProvider: CatalogSyncProvider = new NotConfiguredProvider("Shopify");

export const catalogProviders = [
  blingProvider,
  nuvemshopProvider,
  shopifyProvider,
];
