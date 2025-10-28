import PageBody from "./PageBody";
import { getProducts } from "@/app/utils/products";

export default async function ProductsPage() {
  const products = await getProducts();

  return (
    <div className="p-4">
      <PageBody products={products} />
    </div>
  );
}
