'use client';

import { useMemo, useState } from 'react';
import { EmptyState } from './ui.js';
import { Icon } from './icons.js';

/**
 * Data table with client-side sorting, optional pagination and
 * keyboard-accessible rows. Column config:
 *   { key, label, align: 'right', cls, width, sortable: false,
 *     render(row), sortValue(row) }
 */
export function DataTable({
  columns,
  rows,
  keyFn,
  onRowClick,
  empty,
  pageSize = 0,
  tall = false,
  rowLabel = 'row',
}) {
  const [sort, setSort] = useState(null); // { key, dir: 'asc' | 'desc' }
  const [page, setPage] = useState(0);

  const data = rows || [];

  const sorted = useMemo(() => {
    if (!sort) return data;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return data;
    const pick = col.sortValue || ((r) => r[col.key]);
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...data].sort((a, b) => {
      const av = pick(a);
      const bv = pick(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1; // empty values always sink
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' }) * dir;
    });
  }, [data, sort, columns]);

  const pageCount = pageSize > 0 ? Math.max(1, Math.ceil(sorted.length / pageSize)) : 1;
  const safePage = Math.min(page, pageCount - 1);
  const visible = pageSize > 0 ? sorted.slice(safePage * pageSize, safePage * pageSize + pageSize) : sorted;

  if (!data.length) return empty || <EmptyState />;

  const toggleSort = (col) => {
    setPage(0);
    setSort((prev) => {
      if (prev?.key !== col.key) return { key: col.key, dir: 'asc' };
      if (prev.dir === 'asc') return { key: col.key, dir: 'desc' };
      return null; // third click clears
    });
  };

  const ariaSort = (col) => {
    // must mirror the sortable predicate used for className/onClick above
    const sortable = col.sortable !== false && !!col.key && col.key !== '_actions';
    if (!sortable) return undefined;
    if (sort?.key !== col.key) return 'none';
    return sort.dir === 'asc' ? 'ascending' : 'descending';
  };

  return (
    <>
      <div className={`table-wrap ${tall ? 'tall' : ''}`.trim()}>
        <table className="table">
          <thead>
            <tr>
              {columns.map((c) => {
                const isSorted = sort?.key === c.key;
                const sortable = c.sortable !== false && !!c.key && c.key !== '_actions';
                return (
                  <th
                    key={c.key}
                    className={[
                      c.align === 'right' ? 'right' : '',
                      sortable ? 'sortable' : '',
                      isSorted ? `sorted ${sort.dir}` : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    style={c.width ? { width: c.width } : undefined}
                    aria-sort={ariaSort(c)}
                    scope="col"
                    onClick={sortable ? () => toggleSort(c) : undefined}
                    title={sortable ? `Sort by ${c.label}` : undefined}
                  >
                    <span className="th-in">
                      {c.label}
                      {sortable ? <Icon name="sortArrows" size={11} /> : null}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, idx) => {
              const interactive = !!onRowClick;
              return (
                <tr
                  key={keyFn ? keyFn(row) : row.id ?? idx}
                  className={interactive ? 'clickable' : undefined}
                  onClick={interactive ? () => onRowClick(row) : undefined}
                  tabIndex={interactive ? 0 : undefined}
                  role={interactive ? 'button' : undefined}
                  aria-label={interactive ? `Open ${rowLabel}` : undefined}
                  onKeyDown={
                    interactive
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onRowClick(row);
                          }
                        }
                      : undefined
                  }
                >
                  {columns.map((c) => (
                    <td key={c.key} className={`${c.align === 'right' ? 'right' : ''} ${c.cls || ''}`.trim()}>
                      {c.render ? c.render(row) : row[c.key]}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {pageSize > 0 && sorted.length > pageSize ? (
        <div className="table-foot">
          <span>
            Showing {safePage * pageSize + 1}–{Math.min(sorted.length, (safePage + 1) * pageSize)} of {sorted.length}
          </span>
          <div className="pager">
            <button
              type="button"
              className="icon-btn"
              disabled={safePage === 0}
              onClick={() => setPage(safePage - 1)}
              aria-label="Previous page"
            >
              <Icon name="chevronLeft" size={15} />
            </button>
            <span className="pgno">
              {safePage + 1} / {pageCount}
            </span>
            <button
              type="button"
              className="icon-btn"
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage(safePage + 1)}
              aria-label="Next page"
            >
              <Icon name="chevronRight" size={15} />
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

/** Search + filter toolbar shell. */
export function Toolbar({ children }) {
  return <div className="toolbar">{children}</div>;
}

export function SearchInput({ value, onChange, placeholder = 'Search…' }) {
  return (
    <div className="search">
      <span className="s-ico">
        <Icon name="search" size={14} />
      </span>
      <input
        className="input"
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-label={placeholder}
      />
    </div>
  );
}

export function FilterSelect({ value, onChange, options, label }) {
  return (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
