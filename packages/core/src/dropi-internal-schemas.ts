import { z } from 'zod'

export const MovementSchema = z.object({
  id: z.number(),
  nom_mov: z.string(),
  created_at: z.string(),
  key_base_data: z.number().optional(),
  image_evidence: z.string().nullable().optional(),
})

export type DropiMovement = z.infer<typeof MovementSchema>

const OrderDetailProductSchema = z.object({
  id: z.number(),
  sku: z.string().nullable().optional(),
  name: z.string(),
  sale_price: z.number().nullable().optional(),
  suggested_price: z.number().nullable().optional(),
})

export const OrderDetailSchema = z.object({
  product_id: z.number(),
  product: OrderDetailProductSchema.nullable().optional(),
  variation_id: z.number().nullable().optional(),
  variation: z.unknown().nullable().optional(),
})

const DistributionCompanySchema = z.object({
  id: z.number(),
  name: z.string(),
  color: z.string().nullable().optional(),
  is_veloces: z.boolean().optional(),
})

export const InternalOrderSchema = z.object({
  id: z.number(),
  status: z.string(),
  name: z.string().nullable().optional(),
  surname: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  dir: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  colonia: z.string().nullable().optional(),
  zip_code: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  total_order: z.number().nullable().optional(),
  rate_type: z.string().nullable().optional(),
  type: z.string().nullable().optional(),
  shipping_guide: z.string().nullable().optional(),
  shipping_company: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  shop_order_id: z.string().nullable().optional(),
  shop_order_number: z.number().nullable().optional(),
  user_id: z.number(),
  supplier_id: z.number().nullable().optional(),
  warehouse_id: z.number().nullable().optional(),
  distribution_company_id: z.number().nullable().optional(),
  distribution_company: DistributionCompanySchema.nullable().optional(),
  orderdetails: z.array(OrderDetailSchema).optional(),
  servientrega_movements: z.array(MovementSchema).optional(),
  warranty: z.boolean().optional(),
  invoiced: z.boolean().optional(),
  guia_urls3: z.string().nullable().optional(),
  sticker: z.string().nullable().optional(),
})

export type InternalOrder = z.infer<typeof InternalOrderSchema>

export const InternalListResponseSchema = z.object({
  isSuccess: z.boolean(),
  status: z.number().optional(),
  count: z.number().nullable().optional(),
  objects: z.array(InternalOrderSchema),
})

export type InternalListResponse = z.infer<typeof InternalListResponseSchema>

export const GuideMovementSchema = z.object({
  FechaRegistro: z.string(),
  estatusnuevoname: z.string(),
  Folio: z.string(),
  BitacoraGuiaId: z.number(),
  EstatusNuevo: z.number(),
  GuiaId: z.number(),
  Comentarios: z.array(z.object({
    text: z.string().optional(),
    act_user: z.string().optional(),
  }).passthrough()).optional().default([]),
  Evidencias: z.array(z.unknown()).optional().default([]),
})

export type GuideMovement = z.infer<typeof GuideMovementSchema>

export const GuideHistoryResponseSchema = z.object({
  isSuccess: z.boolean(),
  status: z.number().optional(),
  objects: z.object({
    Movimientos: z.array(GuideMovementSchema).optional().default([]),
    Estatus: z.object({
      Nombre: z.string(),
      Descripcion: z.string().optional(),
      Proceso: z.string().optional(),
    }).optional(),
  }),
})

export type GuideHistoryResponse = z.infer<typeof GuideHistoryResponseSchema>

export const StatusByCountrySchema = z.object({
  name: z.string(),
  id: z.number(),
})

export const StatusByCountryResponseSchema = z.object({
  isSuccess: z.boolean(),
  objects: z.array(StatusByCountrySchema),
})
