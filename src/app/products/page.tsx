import PageBody from "./PageBody";
import ShopSettingsPanel from "./ShopSettingsPanel";
import { getAdminProducts } from "@/app/utils/products";
import { getShopSettings } from "@/app/utils/shop/settings";
import { DEFAULT_SHOP_SETTINGS } from "@/app/utils/shop/schema";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  const [products, settings] = await Promise.all([getAdminProducts(), getShopSettings()]);

  return (
    <div className="p-4">
      <ShopSettingsPanel settings={settings} defaults={DEFAULT_SHOP_SETTINGS} />
      <PageBody products={products} />
    </div>
  );
}
