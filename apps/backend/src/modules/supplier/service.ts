import { MedusaService } from "@medusajs/framework/utils"
import Supplier from "./models/supplier"
import SupplierProduct from "./models/supplier-product"

class SupplierModuleService extends MedusaService({
  Supplier,
  SupplierProduct,
}) {}

export default SupplierModuleService
