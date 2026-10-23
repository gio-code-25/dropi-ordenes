import { z } from 'zod'

export const OrderItemSchema = z.object({
  product_id: z.number().optional(),
  sku: z.string().optional(),
  name: z.string().optional(),
  quantity: z.number(),
  unit_price: z.number(),
  subtotal: z.number().optional(),
})

export const OrderSchema = z.object({
  order_id: z.number(),
  status: z.string(),
  customer_name: z.string().nullable().optional(),
  customer_phone: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  total: z.number().nullable().optional(),
  currency: z.string().default('MXN'),
  payment_method: z.string().nullable().optional(),
  shipping_company: z.string().nullable().optional(),
  rate_type: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  tracking_code: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  items: z.array(OrderItemSchema).optional(),
})

export type DropiOrder = z.infer<typeof OrderSchema>

export const ListOrdersResponseSchema = z.object({
  orders: z.array(OrderSchema),
})

export const GetOrderResponseSchema = OrderSchema

export const StatusEntrySchema = z.object({
  status: z.string(),
  company: z.string().nullable().optional(),
})

export const ListStatusesResponseSchema = z.object({
  statuses: z.array(StatusEntrySchema),
})

export const CarrierSchema = z.object({
  id: z.number().optional(),
  name: z.string(),
})

export const ListCarriersResponseSchema = z.object({
  carriers: z.array(CarrierSchema),
})

export const ProductSchema = z.object({
  id: z.number(),
  sku: z.string().nullable().optional(),
  name: z.string(),
  sale_price: z.number().nullable().optional(),
  suggested_price: z.number().nullable().optional(),
  stock: z.number().nullable().optional(),
  supplier_id: z.number().nullable().optional(),
  categories: z.array(z.string()).optional(),
  gallery: z.array(z.any()).optional(),
  variations: z.array(z.any()).optional(),
})

export const ListProductsResponseSchema = z.object({
  products: z.array(ProductSchema),
})
