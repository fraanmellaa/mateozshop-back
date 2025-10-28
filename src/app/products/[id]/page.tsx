import { getProductById } from "@/app/utils/products";
import { notFound } from "next/navigation";
import Image from "next/image";

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const productId = parseInt(id);
  if (isNaN(productId)) {
    return notFound();
  }

  const product = await getProductById(productId);
  if (!product) {
    return notFound();
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="bg-card rounded-lg shadow-lg overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-purple-600 p-6 text-white">
          <div className="flex items-center gap-4">
            <Image
              src={product.image}
              alt={product.name}
              width={80}
              height={80}
              className="rounded-lg object-cover"
            />
            <div>
              <h1 className="text-3xl font-bold">{product.name}</h1>
              <p className="text-blue-100 mt-2">{product.description}</p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Product Info */}
            <div className="space-y-4">
              <h2 className="text-xl font-semibold mb-4">
                Información del Producto
              </h2>

              <div className="bg-muted/50 p-4 rounded-lg">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <span className="text-sm font-medium text-muted-foreground">
                      ID
                    </span>
                    <p className="text-lg font-semibold">#{product.id}</p>
                  </div>
                  <div>
                    <span className="text-sm font-medium text-muted-foreground">
                      Precio
                    </span>
                    <p className="text-lg font-semibold">{product.price} pts</p>
                  </div>
                  <div>
                    <span className="text-sm font-medium text-muted-foreground">
                      Stock
                    </span>
                    <p className="text-lg font-semibold">
                      {product.stock} unidades
                    </p>
                  </div>
                  <div>
                    <span className="text-sm font-medium text-muted-foreground">
                      Creado
                    </span>
                    <p className="text-lg">
                      {new Date(product.created_at * 1000).toLocaleDateString(
                        "es-ES"
                      )}
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-muted/50 p-4 rounded-lg">
                <span className="text-sm font-medium text-muted-foreground">
                  Enviable
                </span>
                <div className="flex items-center gap-2 mt-1">
                  <div
                    className={`w-3 h-3 rounded-full ${
                      product.sendable ? "bg-green-500" : "bg-gray-500"
                    }`}
                  />
                  <span className="font-medium">
                    {product.sendable
                      ? "Sí, envía códigos"
                      : "No envía códigos"}
                  </span>
                </div>
              </div>
            </div>

            {/* Codes Section */}
            {product.sendable && (
              <div className="space-y-4">
                <h2 className="text-xl font-semibold mb-4">
                  Gestión de Códigos
                </h2>

                {/* Available Codes */}
                <div className="bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 p-4 rounded-lg">
                  <h3 className="font-medium text-green-800 dark:text-green-200 mb-2">
                    Códigos Disponibles ({product.codes.length})
                  </h3>
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {product.codes.length > 0 ? (
                      product.codes.map((code: string, index: number) => (
                        <div
                          key={index}
                          className="bg-white dark:bg-green-900/30 px-3 py-2 rounded border text-sm font-mono"
                        >
                          {code}
                        </div>
                      ))
                    ) : (
                      <p className="text-green-600 dark:text-green-400 text-sm">
                        No hay códigos disponibles
                      </p>
                    )}
                  </div>
                </div>

                {/* Used Codes */}
                <div className="bg-gray-50 dark:bg-gray-950/20 border border-gray-200 dark:border-gray-800 p-4 rounded-lg">
                  <h3 className="font-medium text-gray-800 dark:text-gray-200 mb-2">
                    Códigos Usados ({product.used_codes.length})
                  </h3>
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {product.used_codes.length > 0 ? (
                      product.used_codes.map((code: string, index: number) => (
                        <div
                          key={index}
                          className="bg-white dark:bg-gray-900/30 px-3 py-2 rounded border text-sm font-mono opacity-60"
                        >
                          {code}
                        </div>
                      ))
                    ) : (
                      <p className="text-gray-600 dark:text-gray-400 text-sm">
                        No hay códigos usados
                      </p>
                    )}
                  </div>
                </div>

                {/* Stats */}
                <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 p-4 rounded-lg">
                  <h3 className="font-medium text-blue-800 dark:text-blue-200 mb-2">
                    Estadísticas
                  </h3>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-blue-600 dark:text-blue-400">
                        Total códigos:
                      </span>
                      <span className="ml-2 font-semibold">
                        {product.codes.length + product.used_codes.length}
                      </span>
                    </div>
                    <div>
                      <span className="text-blue-600 dark:text-blue-400">
                        Tasa de uso:
                      </span>
                      <span className="ml-2 font-semibold">
                        {product.codes.length + product.used_codes.length > 0
                          ? Math.round(
                              (product.used_codes.length /
                                (product.codes.length +
                                  product.used_codes.length)) *
                                100
                            )
                          : 0}
                        %
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
