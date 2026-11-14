import PageBody from "./PageBody";
import { getAdminProducts } from "@/app/utils/products";

export default async function ProductsPage() {
  const products = await getAdminProducts();

  return (
    <div className="p-4">
      <PageBody products={products} />
    </div>
  );
}
