import { MedusaService } from "@medusajs/framework/utils"
import Supplier from "./models/supplier"

class SupplierModuleService extends MedusaService({
  Supplier,
}) {}

export default SupplierModuleService
