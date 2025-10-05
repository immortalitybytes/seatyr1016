/**
 * Utility functions for table management
 */

/**
 * Back-compatible capacity reader: number or array supported.
 * @param t Table object with seats (number or array) or capacity property
 * @returns Normalized capacity as number
 */
export const getCapacity = (t: { seats?: number | any[]; capacity?: number }) => {
  if (Array.isArray(t.seats)) {
    return t.seats.length;
  }
  
  if (Number.isFinite(t.seats)) {
    return Math.max(1, Math.floor(Number(t.seats)));
  }
  
  if (Number.isFinite(t.capacity)) {
    return Math.max(1, Math.floor(Number(t.capacity)));
  }
  
  return 0;
};

/**
 * Calculate the minimum number of tables needed for a given number of guests
 * @param guests Guest list array
 * @param seatsPerTable Number of seats per table (default: 8)
 * @returns The minimum number of tables needed
 */
export function calculateMinTablesNeeded(guests: { name: string; count: number }[], seatsPerTable: number = 8): number {
  const totalGuestCount = guests.reduce((sum, guest) => sum + guest.count, 0);
  return Math.ceil(totalGuestCount / seatsPerTable);
}

/**
 * Calculate total capacity of all tables
 * @param tables Array of tables
 * @returns Total capacity
 */
export function calculateTotalCapacity(tables: { id: number; seats: number | any[]; capacity?: number }[]): number {
  return tables.reduce((sum, table) => sum + getCapacity(table), 0);
}

/**
 * Check if tables can be reduced based on guest count
 * @param guests Guest list array
 * @param tables Array of tables
 * @returns Object with canReduce flag and minimum tables needed
 */
export function canReduceTables(
  guests: { name: string; count: number }[],
  tables: { id: number; seats: number | any[]; capacity?: number }[]
): { canReduce: boolean; minTablesNeeded: number; currentCapacity: number; requiredCapacity: number } {
  const totalGuestCount = guests.reduce((sum, guest) => sum + guest.count, 0);
  const maxSeats = Math.max(8, ...tables.map(t => getCapacity(t)));
  const minTablesNeeded = Math.ceil(totalGuestCount / Math.max(1, maxSeats));
  const currentCapacity = calculateTotalCapacity(tables);
  
  return {
    canReduce: tables.length > minTablesNeeded && totalGuestCount > 0,
    minTablesNeeded,
    currentCapacity,
    requiredCapacity: totalGuestCount
  };
}