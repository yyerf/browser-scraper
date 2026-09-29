export function expectedProduct(
  page: number,
  offset: number,
): {
  name: string
  price: string
  rating: string
} {
  const id = (page - 1) * 20 + offset + 1
  return { name: `Product ${id}`, price: `$${100 + id - 1}`, rating: (4 + id / 100).toFixed(2) }
}

export const expectedThreePageCount = 60
