import React, { useState } from 'react';
import {
  Box,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TablePagination,
} from '@mui/material';
import { styled, alpha } from '@mui/material/styles';
import { tableCellClasses } from '@mui/material/TableCell';
import { formatCell, humanizeHeader, isNumericType } from '../utils/format';

// Clean, self-contained result card. Shared by the chat bubble (ChatMessage)
// and the agent-mode research trace (ResearchTrace) so query results look
// identical everywhere.
const TableCard = styled(Box)(({ theme }) => ({
  marginTop: theme.spacing(1),
  borderRadius: 10,
  border: `1px solid ${theme.palette.divider}`,
  backgroundColor: theme.palette.background.paper,
  overflowX: 'auto',
}));

const StyledTableCell = styled(TableCell)(({ theme }) => ({
  borderBottom: `1px solid ${theme.palette.divider}`,
  whiteSpace: 'nowrap',
  [`&.${tableCellClasses.head}`]: {
    backgroundColor: alpha(theme.palette.primary.main, 0.08),
    color: theme.palette.text.primary,
    fontWeight: 600,
    fontSize: 12,
    letterSpacing: 0.2,
  },
  [`&.${tableCellClasses.body}`]: {
    fontSize: 13,
    color: theme.palette.text.primary,
  },
}));

const StyledTableRow = styled(TableRow)(({ theme }) => ({
  '&:hover': { backgroundColor: theme.palette.action.hover },
  '&:last-child td, &:last-child th': { border: 0 },
}));

// rows: array of row objects; columns: ordered column names; schema: {name: SQL_TYPE}
const ResultTable = ({ rows, columns, schema = {} }) => {
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  if (!rows || rows.length === 0) return null;
  const cols = columns && columns.length ? columns : Object.keys(rows[0]);
  const paginated = rows.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  return (
    <TableCard>
      <Table size="small" sx={{ '& td, & th': { py: 0.75, px: 1.5 } }}>
        <TableHead>
          <TableRow>
            {cols.map((header) => (
              <StyledTableCell key={header} align={isNumericType(schema[header]) ? 'right' : 'left'}>
                {humanizeHeader(header)}
              </StyledTableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {paginated.map((row, index) => (
            <StyledTableRow key={index}>
              {cols.map((col) => (
                <StyledTableCell key={col} align={isNumericType(schema[col]) ? 'right' : 'left'}>
                  {formatCell(row[col], schema[col], col)}
                </StyledTableCell>
              ))}
            </StyledTableRow>
          ))}
        </TableBody>
      </Table>
      {rows.length > rowsPerPage && (
        <TablePagination
          component="div"
          rowsPerPageOptions={[10, 20, 50]}
          count={rows.length}
          rowsPerPage={rowsPerPage}
          page={page}
          onPageChange={(e, p) => setPage(p)}
          onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
          sx={{ borderTop: (theme) => `1px solid ${theme.palette.divider}` }}
        />
      )}
    </TableCard>
  );
};

export default ResultTable;
