import { Request } from 'express';
import { getPagination, paginatedResponse, PaginationParams } from '../../utils/pagination';

describe('getPagination', () => {
  function createReq(query: Record<string, string>): Request {
    return { query } as unknown as Request;
  }

  it('should return defaults when no query params provided', () => {
    const result = getPagination(createReq({}));
    expect(result).toEqual({ page: 1, limit: 20, skip: 0 });
  });

  it('should parse page and limit from query', () => {
    const result = getPagination(createReq({ page: '3', limit: '10' }));
    expect(result).toEqual({ page: 3, limit: 10, skip: 20 });
  });

  it('should clamp page to minimum of 1 for negative values', () => {
    const result = getPagination(createReq({ page: '-5' }));
    expect(result.page).toBe(1);
    expect(result.skip).toBe(0);
  });

  it('should clamp page to minimum of 1 for zero', () => {
    const result = getPagination(createReq({ page: '0' }));
    expect(result.page).toBe(1);
  });

  it('should fall back to default limit when limit is 0 (falsy)', () => {
    const result = getPagination(createReq({ limit: '0' }));
    // parseInt('0') is 0 which is falsy, so || 20 kicks in → default 20
    expect(result.limit).toBe(20);
  });

  it('should clamp limit to minimum of 1 for negative values', () => {
    const result = getPagination(createReq({ limit: '-10' }));
    expect(result.limit).toBe(1);
  });

  it('should cap limit at 100', () => {
    const result = getPagination(createReq({ limit: '500' }));
    expect(result.limit).toBe(100);
  });

  it('should handle non-numeric strings gracefully (NaN → defaults)', () => {
    const result = getPagination(createReq({ page: 'abc', limit: 'xyz' }));
    expect(result).toEqual({ page: 1, limit: 20, skip: 0 });
  });

  it('should calculate skip correctly for page 5 with limit 25', () => {
    const result = getPagination(createReq({ page: '5', limit: '25' }));
    expect(result.skip).toBe(100); // (5-1) * 25
  });
});

describe('paginatedResponse', () => {
  it('should format response with correct pagination metadata', () => {
    const data = [{ id: 1 }, { id: 2 }];
    const params: PaginationParams = { page: 1, limit: 10, skip: 0 };

    const result = paginatedResponse(data, 25, params);

    expect(result).toEqual({
      data,
      pagination: {
        page: 1,
        limit: 10,
        total: 25,
        totalPages: 3,
        hasNext: true,
        hasPrev: false,
      },
    });
  });

  it('should set hasNext=false on the last page', () => {
    const data = [{ id: 5 }];
    const params: PaginationParams = { page: 3, limit: 2, skip: 4 };

    const result = paginatedResponse(data, 5, params);

    expect(result.pagination.hasNext).toBe(false);
    expect(result.pagination.hasPrev).toBe(true);
    expect(result.pagination.totalPages).toBe(3);
  });

  it('should set hasPrev=false on page 1', () => {
    const params: PaginationParams = { page: 1, limit: 10, skip: 0 };
    const result = paginatedResponse([], 0, params);

    expect(result.pagination.hasPrev).toBe(false);
    expect(result.pagination.hasNext).toBe(false);
    expect(result.pagination.totalPages).toBe(0);
  });

  it('should handle middle pages correctly', () => {
    const params: PaginationParams = { page: 2, limit: 10, skip: 10 };
    const result = paginatedResponse([{ id: 1 }], 30, params);

    expect(result.pagination.hasNext).toBe(true);
    expect(result.pagination.hasPrev).toBe(true);
    expect(result.pagination.totalPages).toBe(3);
  });

  it('should return empty data array with correct metadata', () => {
    const params: PaginationParams = { page: 1, limit: 20, skip: 0 };
    const result = paginatedResponse([], 0, params);

    expect(result.data).toEqual([]);
    expect(result.pagination.total).toBe(0);
    expect(result.pagination.totalPages).toBe(0);
  });
});
