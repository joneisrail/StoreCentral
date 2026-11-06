import { MedusaError } from "@medusajs/framework/utils"
import SupplierModuleService from "../../modules/supplier/service"

export const VARIANT_ALREADY_LISTED =
  "This variant is already on this supplier's list"

export const codeAlreadyUsed = (supplierSku: string) =>
  `Supplier code "${supplierSku}" is already used by this supplier`

// Index names from the supplier module migration.
const VARIANT_INDEX = "IDX_supplier_product_supplier_id_variant_id_unique"
const SKU_KEY_INDEX = "IDX_supplier_product_supplier_id_supplier_sku_key_unique"

type Conflict = "variant" | "code"

type ConflictCheck = {
  supplier_id: string
  supplier_sku: string
  supplier_sku_key: string
  // Set when creating; an update never changes the variant.
  variant_id?: string
  // Set when updating, so the entry does not conflict with itself.
  exclude_id?: string
}

const conflictError = (conflict: Conflict, supplierSku: string) =>
  new MedusaError(
    MedusaError.Types.INVALID_DATA,
    conflict === "variant"
      ? VARIANT_ALREADY_LISTED
      : codeAlreadyUsed(supplierSku)
  )

// Looks up an existing entry that would collide with the write.
const findConflict = async (
  service: SupplierModuleService,
  check: ConflictCheck
): Promise<Conflict | null> => {
  const notSelf = check.exclude_id ? { id: { $ne: check.exclude_id } } : {}

  if (check.variant_id) {
    const [byVariant] = await service.listSupplierProducts(
      { supplier_id: check.supplier_id, variant_id: check.variant_id, ...notSelf },
      { select: ["id"], take: 1 }
    )
    if (byVariant) {
      return "variant"
    }
  }

  const [byCode] = await service.listSupplierProducts(
    {
      supplier_id: check.supplier_id,
      supplier_sku_key: check.supplier_sku_key,
      ...notSelf,
    },
    { select: ["id"], take: 1 }
  )
  return byCode ? "code" : null
}

// Friendly pre-check before writing.
export const assertNoConflict = async (
  service: SupplierModuleService,
  check: ConflictCheck
) => {
  const conflict = await findConflict(service, check)
  if (conflict) {
    throw conflictError(conflict, check.supplier_sku)
  }
}

// Finds a Postgres unique violation (23505) on the error or its cause chain.
const findUniqueViolation = (
  err: unknown
): { constraint?: string } | null => {
  let current = err as { code?: unknown; constraint?: unknown; cause?: unknown }
  for (let depth = 0; current && depth < 5; depth++) {
    if (current.code === "23505") {
      return {
        constraint:
          typeof current.constraint === "string" ? current.constraint : undefined,
      }
    }
    current = current.cause as typeof current
  }
  return null
}

const conflictFromConstraint = (constraint?: string): Conflict | null => {
  if (constraint === VARIANT_INDEX) {
    return "variant"
  }
  if (constraint === SKU_KEY_INDEX) {
    return "code"
  }
  return null
}

// Runs a write and turns a lost race on the unique indexes into the same
// INVALID_DATA error as the pre-check. A raw 23505 names its index directly.
// Medusa's repository maps 23505 to an INVALID_DATA MedusaError without the
// code, so for that error (and a 23505 with an unknown index) the database is
// asked again: the competing row is committed by the time the violation is
// raised, so the lookup finds it. Any other failure is rethrown unchanged.
export const withConflictHandling = async <T>(
  service: SupplierModuleService,
  check: ConflictCheck,
  write: () => Promise<T>
): Promise<T> => {
  try {
    return await write()
  } catch (err) {
    const violation = findUniqueViolation(err)
    const mapped =
      err instanceof MedusaError && err.type === MedusaError.Types.INVALID_DATA
    if (!violation && !mapped) {
      throw err
    }

    const conflict =
      conflictFromConstraint(violation?.constraint) ??
      (await findConflict(service, check))
    if (conflict) {
      throw conflictError(conflict, check.supplier_sku)
    }
    throw err
  }
}

// Loads an entry only when it belongs to the supplier; otherwise 404.
export const retrieveSupplierProductForSupplier = async (
  service: SupplierModuleService,
  supplierId: string,
  id: string
) => {
  const [row] = await service.listSupplierProducts(
    { id, supplier_id: supplierId },
    { take: 1 }
  )
  if (!row) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Supplier product with id: ${id} was not found`
    )
  }
  return row
}
