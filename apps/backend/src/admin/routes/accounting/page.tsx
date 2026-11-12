import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Navigate } from "react-router-dom"

// Parent route for the Accounting sidebar group; sub-pages live under it.
const AccountingPage = () => <Navigate to="/accounting/overview" replace />

export const config = defineRouteConfig({
  label: "Accounting",
})

export default AccountingPage
