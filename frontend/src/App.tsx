import React, {
  useEffect,
  useState,
  useMemo,
  useRef,
  useCallback,
} from "react";
import Papa from "papaparse";
import { FixedSizeList } from "react-window";
import AutoSizer from "react-virtualized-auto-sizer";
import {
  Box,
  Container,
  Typography,
  TextField,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  TableSortLabel,
  Toolbar,
  Button,
  CircularProgress,
  Menu,
  MenuItem,
  Checkbox,
  IconButton,
  ListItemText,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Select,
  MenuItem as MuiMenuItem,
  Stack,
  Chip,
  FormControl,
  InputLabel,
} from "@mui/material";
import DownloadIcon from "@mui/icons-material/Download";
import ViewColumnIcon from "@mui/icons-material/ViewColumn";
import FilterListIcon from "@mui/icons-material/FilterList";
import {
  DragDropContext,
  Droppable,
  Draggable,
  DropResult,
} from "@hello-pangea/dnd";
import "./App.css";

// Utility to export CSV
const exportToCsv = (rows: any[], headers: string[], filename: string) => {
  const csv = [
    headers.join(","),
    ...rows.map((row) =>
      headers.map((h) => JSON.stringify(row[h] ?? "")).join(",")
    ),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  window.URL.revokeObjectURL(url);
};

const CSV_URL = "/merged_df.csv";

type Row = Record<string, string>;

type Order = "asc" | "desc";

// Helper to map filter type to user-friendly label
const filterTypeLabel = (type: string) => {
  switch (type) {
    case "equals":
      return "=";
    case "gt":
      return ">";
    case "lt":
      return "<";
    case "range":
      return "between";
    case "contains":
      return "contains";
    case "before":
      return "before";
    case "after":
      return "after";
    default:
      return type;
  }
};

// Add debounce utility
const useDebounce = (value: string, delay: number) => {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
};

// Define column widths (adjust as needed)
const DEFAULT_COL_WIDTH = 180;

const getColumnWidths = (columns: string[]) => {
  // You can customize widths per column here if needed
  return columns.reduce((acc, col) => {
    acc[col] = DEFAULT_COL_WIDTH;
    return acc;
  }, {} as Record<string, number>);
};

const ROW_HEIGHT = 48;

const App: React.FC = () => {
  const [data, setData] = useState<Row[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [orderBy, setOrderBy] = useState<string>("");
  const [order, setOrder] = useState<Order>("asc");
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [visibleColumns, setVisibleColumns] = useState<string[]>([]);
  const [columnOrder, setColumnOrder] = useState<string[]>([]);
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>(
    {}
  );
  // Filter modal state
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [filterCol, setFilterCol] = useState<string>("");
  const [filterType, setFilterType] = useState<string>("");
  const [filterValue, setFilterValue] = useState<any>("");
  const [filterValue2, setFilterValue2] = useState<any>("");
  const [activeFilters, setActiveFilters] = useState<any[]>([]); // {col, type, value, value2, colType}
  // Add state for filter column search
  const [filterColSearch, setFilterColSearch] = useState("");
  // Add state for column selection search
  const [columnSelectSearch, setColumnSelectSearch] = useState("");

  // Add debounced search
  const debouncedSearch = useDebounce(search, 300);

  // Memoize the column type guessing function
  const guessColumnType = useCallback(
    (col: string, data: Row[]): "number" | "date" | "string" => {
      const sample = data.find((row) => row[col] && row[col].trim() !== "")?.[
        col
      ];
      if (!sample) return "string";
      if (!isNaN(Number(sample))) return "number";
      if (!isNaN(Date.parse(sample))) return "date";
      return "string";
    },
    []
  );

  // Load CSV
  useEffect(() => {
    Papa.parse(CSV_URL, {
      download: true,
      header: true,
      skipEmptyLines: true,
      complete: (results: Papa.ParseResult<Row>) => {
        setData(results.data as Row[]);
        setHeaders(results.meta.fields || []);
        setVisibleColumns(results.meta.fields || []);
        setColumnOrder(results.meta.fields || []);
        setLoading(false);
      },
    });
  }, []);

  // Filtering logic
  const filteredData = useMemo(() => {
    let filtered = data;
    // Global search
    if (debouncedSearch) {
      const lower = debouncedSearch.toLowerCase();
      filtered = filtered.filter((row) =>
        visibleColumns.some((h) => (row[h] || "").toLowerCase().includes(lower))
      );
    }
    // Advanced filters
    activeFilters.forEach((f) => {
      filtered = filtered.filter((row) => {
        const val = row[f.col];
        if (f.colType === "number") {
          const num = Number(val);
          if (f.type === "equals") return num === Number(f.value);
          if (f.type === "gt") return num > Number(f.value);
          if (f.type === "lt") return num < Number(f.value);
          if (f.type === "range")
            return num >= Number(f.value) && num <= Number(f.value2);
        } else if (f.colType === "date") {
          const d = new Date(val).getTime();
          if (f.type === "equals") return d === new Date(f.value).getTime();
          if (f.type === "before") return d < new Date(f.value).getTime();
          if (f.type === "after") return d > new Date(f.value).getTime();
          if (f.type === "range")
            return (
              d >= new Date(f.value).getTime() &&
              d <= new Date(f.value2).getTime()
            );
        } else {
          if (f.type === "contains")
            return (val || "")
              .toLowerCase()
              .includes((f.value || "").toLowerCase());
          if (f.type === "equals") return (val || "") === f.value;
        }
        return true;
      });
    });
    return filtered;
  }, [data, debouncedSearch, activeFilters, visibleColumns]);

  // Sorting logic
  const sortedData = useMemo(() => {
    if (!orderBy) return filteredData;
    return [...filteredData].sort((a, b) => {
      const aVal = a[orderBy] || "";
      const bVal = b[orderBy] || "";
      if (!isNaN(Number(aVal)) && !isNaN(Number(bVal))) {
        return order === "asc"
          ? Number(aVal) - Number(bVal)
          : Number(bVal) - Number(aVal);
      }
      return order === "asc"
        ? aVal.localeCompare(bVal)
        : bVal.localeCompare(aVal);
    });
  }, [filteredData, orderBy, order]);

  // Memoize displayed columns computation
  const displayedColumns = useMemo(
    () => columnOrder.filter((col) => visibleColumns.includes(col)),
    [columnOrder, visibleColumns]
  );

  // Memoize column widths
  const columnWidths = useMemo(
    () => getColumnWidths(displayedColumns),
    [displayedColumns]
  );
  const totalWidth = useMemo(
    () => displayedColumns.reduce((sum, col) => sum + columnWidths[col], 0),
    [displayedColumns, columnWidths]
  );

  // Optimize pagination
  const [rowsToShow, setRowsToShow] = useState(50);
  const tableBodyRef = useRef<HTMLTableSectionElement>(null);
  const loadingMoreRef = useRef(false);

  const handleScroll = useCallback(() => {
    if (!tableBodyRef.current || loadingMoreRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } =
      tableBodyRef.current.parentElement!;
    if (scrollTop + clientHeight >= scrollHeight - 50) {
      loadingMoreRef.current = true;
      requestAnimationFrame(() => {
        setRowsToShow((prev) => Math.min(prev + 50, sortedData.length));
        loadingMoreRef.current = false;
      });
    }
  }, [sortedData.length]);

  useEffect(() => {
    setRowsToShow(50);
  }, [sortedData]);

  // Sorting: toggle asc/desc on click
  const handleSort = (column: string) => {
    if (orderBy === column) {
      setOrder(order === "asc" ? "desc" : "asc");
    } else {
      setOrderBy(column);
      setOrder("asc");
    }
  };

  // Show/hide columns dropdown
  const handleOpenColumns = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };
  const handleCloseColumns = () => {
    setAnchorEl(null);
  };
  const handleToggleColumn = (col: string) => {
    setVisibleColumns((prev) =>
      prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]
    );
  };

  // Drag and drop column reordering
  const onDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    const newOrder = Array.from(columnOrder);
    const [removed] = newOrder.splice(result.source.index, 1);
    newOrder.splice(result.destination.index, 0, removed);
    setColumnOrder(newOrder);
  };

  // Filter input change
  const handleFilterChange = (col: string, value: string) => {
    setColumnFilters((prev) => ({ ...prev, [col]: value }));
  };

  // Open/close filter modal
  const handleOpenFilter = () => setFilterModalOpen(true);
  const handleCloseFilter = () => {
    setFilterModalOpen(false);
    setFilterCol("");
    setFilterType("");
    setFilterValue("");
    setFilterValue2("");
  };

  // Add filter
  const handleAddFilter = () => {
    if (!filterCol || !filterType || filterValue === "") return;
    setActiveFilters((prev) => [
      ...prev,
      {
        col: filterCol,
        type: filterType,
        value: filterValue,
        value2: filterValue2,
        colType: guessColumnType(filterCol, data),
      },
    ]);
    setFilterCol("");
    setFilterType("");
    setFilterValue("");
    setFilterValue2("");
  };
  // Remove filter
  const handleRemoveFilter = (idx: number) => {
    setActiveFilters((prev) => prev.filter((_, i) => i !== idx));
  };

  // Virtualized row
  const Row = ({
    index,
    style,
  }: {
    index: number;
    style: React.CSSProperties;
  }) => {
    const row = sortedData[index];
    return (
      <Box
        style={{ ...style, width: totalWidth, display: "flex" }}
        sx={{
          borderBottom: "1px solid #f0f0f0",
          bgcolor: "#fff",
          "&:hover": { bgcolor: "#f5f5f5" },
        }}
      >
        {displayedColumns.map((header) => (
          <Box
            key={`cell-${header}-${index}`}
            sx={{
              width: columnWidths[header],
              minWidth: columnWidths[header],
              maxWidth: columnWidths[header],
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              px: 2,
              py: 1,
              color: "#111",
              fontSize: 15,
              display: "flex",
              alignItems: "center",
            }}
            title={row[header]}
          >
            {row[header]}
          </Box>
        ))}
      </Box>
    );
  };

  return (
    <Box
      sx={{
        minHeight: "100vh",
        bgcolor: "#fff",
        fontFamily: "Inter, Roboto, Arial, sans-serif",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Container
        maxWidth={false}
        disableGutters
        sx={{
          py: 2,
          px: 0,
          width: "100vw",
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          flex: 1,
        }}
      >
        <Typography
          variant="h4"
          align="center"
          gutterBottom
          sx={{ fontWeight: 700, letterSpacing: 0.5, color: "#111" }}
        >
          Company Database
        </Typography>
        <Box
          display="flex"
          alignItems="center"
          justifyContent="space-between"
          mb={2}
          gap={2}
          px={2}
        >
          <TextField
            label="Search by any field"
            variant="outlined"
            size="small"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ flex: 1, bgcolor: "#fff" }}
            InputLabelProps={{ style: { color: "#222" } }}
            inputProps={{ style: { color: "#111" } }}
          />
          <Tooltip title="Advanced Filter">
            <IconButton
              onClick={handleOpenFilter}
              sx={{ bgcolor: "#eee", ml: 1 }}
            >
              <FilterListIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title="Show/Hide/Reorder Columns">
            <IconButton
              onClick={handleOpenColumns}
              sx={{ bgcolor: "#eee", ml: 1 }}
            >
              <ViewColumnIcon />
            </IconButton>
          </Tooltip>
          <Menu
            anchorEl={anchorEl}
            open={Boolean(anchorEl)}
            onClose={handleCloseColumns}
          >
            <Box
              display="flex"
              justifyContent="space-between"
              alignItems="center"
              px={2}
              py={1}
            >
              <Button
                size="small"
                onClick={() => setVisibleColumns([...columnOrder])}
              >
                Select All
              </Button>
              <Button size="small" onClick={() => setVisibleColumns([])}>
                Deselect All
              </Button>
            </Box>
            {/* Column search */}
            <Box px={2} pb={1}>
              <TextField
                label="Search columns"
                value={columnSelectSearch}
                onChange={(e) => setColumnSelectSearch(e.target.value)}
                fullWidth
                size="small"
              />
            </Box>
            <DragDropContext onDragEnd={onDragEnd}>
              <Droppable droppableId="columns-droppable">
                {(provided) => (
                  <Box ref={provided.innerRef} {...provided.droppableProps}>
                    {columnOrder
                      .filter((col) =>
                        col
                          .toLowerCase()
                          .includes(columnSelectSearch.toLowerCase())
                      )
                      .map((col, idx) => (
                        <Draggable key={col} draggableId={col} index={idx}>
                          {(dragProvided) => (
                            <MenuItem
                              dense
                              ref={dragProvided.innerRef}
                              {...dragProvided.draggableProps}
                              {...dragProvided.dragHandleProps}
                              sx={{
                                display: "flex",
                                alignItems: "center",
                                gap: 1,
                              }}
                            >
                              <Checkbox
                                checked={visibleColumns.includes(col)}
                                onChange={() => handleToggleColumn(col)}
                              />
                              <ListItemText primary={col} />
                            </MenuItem>
                          )}
                        </Draggable>
                      ))}
                    {provided.placeholder}
                  </Box>
                )}
              </Droppable>
            </DragDropContext>
          </Menu>
          <Button
            variant="contained"
            startIcon={<DownloadIcon />}
            onClick={() =>
              exportToCsv(
                sortedData,
                displayedColumns,
                "filtered_companies.csv"
              )
            }
            disabled={loading || sortedData.length === 0}
            sx={{
              bgcolor: "#111",
              color: "#fff",
              fontWeight: 600,
              px: 3,
              boxShadow: 1,
              "&:hover": { bgcolor: "#333" },
            }}
          >
            Export CSV
          </Button>
        </Box>
        {/* Active filters display */}
        {activeFilters.length > 0 && (
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            px={2}
            mb={1}
            flexWrap="wrap"
          >
            {activeFilters.map((f, idx) => (
              <Chip
                key={idx}
                label={`${f.col} ${filterTypeLabel(f.type)}${
                  f.value2 ? ` ${f.value} - ${f.value2}` : ` ${f.value}`
                }`}
                onDelete={() => handleRemoveFilter(idx)}
                sx={{
                  fontWeight: 500,
                  fontSize: 15,
                  bgcolor: "#f0f0f0",
                  color: "#222",
                  m: 0.5,
                }}
              />
            ))}
          </Stack>
        )}
        {/* Filter Modal */}
        <Dialog open={filterModalOpen} onClose={handleCloseFilter}>
          <DialogTitle>Add Filter</DialogTitle>
          <DialogContent>
            <Stack spacing={2} minWidth={300}>
              {/* Column search */}
              <TextField
                label="Search columns"
                value={filterColSearch}
                onChange={(e) => setFilterColSearch(e.target.value)}
                fullWidth
                size="small"
              />
              <FormControl fullWidth>
                <InputLabel>Column</InputLabel>
                <Select
                  value={filterCol}
                  label="Column"
                  onChange={(e) => {
                    setFilterCol(e.target.value);
                    setFilterType("");
                    setFilterValue("");
                    setFilterValue2("");
                  }}
                >
                  {displayedColumns
                    .filter((col) =>
                      col.toLowerCase().includes(filterColSearch.toLowerCase())
                    )
                    .map((col) => (
                      <MuiMenuItem key={col} value={col}>
                        {col}
                      </MuiMenuItem>
                    ))}
                </Select>
              </FormControl>
              {filterCol && (
                <>
                  <FormControl fullWidth>
                    <InputLabel>Type</InputLabel>
                    <Select
                      value={filterType}
                      label="Type"
                      onChange={(e) => {
                        setFilterType(e.target.value);
                        setFilterValue("");
                        setFilterValue2("");
                      }}
                    >
                      {(() => {
                        const colType = guessColumnType(filterCol, data);
                        if (colType === "number") {
                          return [
                            <MuiMenuItem value="equals" key="equals">
                              Equals
                            </MuiMenuItem>,
                            <MuiMenuItem value="gt" key="gt">
                              Greater than
                            </MuiMenuItem>,
                            <MuiMenuItem value="lt" key="lt">
                              Less than
                            </MuiMenuItem>,
                            <MuiMenuItem value="range" key="range">
                              Range
                            </MuiMenuItem>,
                          ];
                        } else if (colType === "date") {
                          return [
                            <MuiMenuItem value="equals" key="equals">
                              Equals
                            </MuiMenuItem>,
                            <MuiMenuItem value="before" key="before">
                              Before
                            </MuiMenuItem>,
                            <MuiMenuItem value="after" key="after">
                              After
                            </MuiMenuItem>,
                            <MuiMenuItem value="range" key="range">
                              Range
                            </MuiMenuItem>,
                          ];
                        } else {
                          return [
                            <MuiMenuItem value="contains" key="contains">
                              Contains
                            </MuiMenuItem>,
                            <MuiMenuItem value="equals" key="equals">
                              Equals
                            </MuiMenuItem>,
                          ];
                        }
                      })()}
                    </Select>
                  </FormControl>
                  {/* Value input(s) */}
                  {(() => {
                    const colType = guessColumnType(filterCol, data);
                    if (filterType === "range") {
                      if (colType === "number") {
                        return (
                          <Stack direction="row" spacing={1}>
                            <TextField
                              label="Min"
                              type="number"
                              value={filterValue}
                              onChange={(e) => setFilterValue(e.target.value)}
                            />
                            <TextField
                              label="Max"
                              type="number"
                              value={filterValue2}
                              onChange={(e) => setFilterValue2(e.target.value)}
                            />
                          </Stack>
                        );
                      } else if (colType === "date") {
                        return (
                          <Stack direction="row" spacing={1}>
                            <TextField
                              label="From"
                              type="date"
                              InputLabelProps={{ shrink: true }}
                              value={filterValue}
                              onChange={(e) => setFilterValue(e.target.value)}
                            />
                            <TextField
                              label="To"
                              type="date"
                              InputLabelProps={{ shrink: true }}
                              value={filterValue2}
                              onChange={(e) => setFilterValue2(e.target.value)}
                            />
                          </Stack>
                        );
                      }
                    } else if (colType === "number") {
                      return (
                        <TextField
                          label="Value"
                          type="number"
                          value={filterValue}
                          onChange={(e) => setFilterValue(e.target.value)}
                          fullWidth
                        />
                      );
                    } else if (colType === "date") {
                      return (
                        <TextField
                          label="Value"
                          type="date"
                          InputLabelProps={{ shrink: true }}
                          value={filterValue}
                          onChange={(e) => setFilterValue(e.target.value)}
                          fullWidth
                        />
                      );
                    } else {
                      return (
                        <TextField
                          label="Value"
                          value={filterValue}
                          onChange={(e) => setFilterValue(e.target.value)}
                          fullWidth
                        />
                      );
                    }
                  })()}
                </>
              )}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={handleCloseFilter}>Cancel</Button>
            <Button
              onClick={handleAddFilter}
              variant="contained"
              disabled={!filterCol || !filterType || filterValue === ""}
            >
              Add Filter
            </Button>
          </DialogActions>
        </Dialog>
        {/* Table area fills remaining space */}
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            width: "100%",
          }}
        >
          <Paper
            elevation={2}
            sx={{
              width: "100%",
              maxWidth: "100vw",
              overflowX: "auto",
              borderRadius: 3,
              boxShadow: 2,
              display: "flex",
              flexDirection: "column",
              flex: 1,
              minHeight: 0,
            }}
          >
            {/* Flexbox header */}
            <Box
              sx={{
                display: "flex",
                width: totalWidth,
                bgcolor: "#fff",
                borderBottom: "2px solid #eee",
                fontWeight: 700,
                position: "sticky",
                top: 0,
                zIndex: 2,
              }}
            >
              {displayedColumns.map((header, idx) => (
                <Box
                  key={header}
                  sx={{
                    width: columnWidths[header],
                    minWidth: columnWidths[header],
                    maxWidth: columnWidths[header],
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    px: 2,
                    py: 1,
                    color: "#111",
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    borderRight:
                      idx === displayedColumns.length - 1
                        ? "none"
                        : "1px solid #eee",
                    cursor: "pointer",
                  }}
                  onClick={() => handleSort(header)}
                >
                  {header}
                  {orderBy === header && (
                    <Box component="span" sx={{ ml: 1, fontSize: 12 }}>
                      {order === "asc" ? "▲" : "▼"}
                    </Box>
                  )}
                </Box>
              ))}
            </Box>
            {/* Virtualized body fills all available space */}
            <Box sx={{ flex: 1, minHeight: 0, width: totalWidth }}>
              {/* @ts-ignore: AutoSizer default export JSX quirk */}
              <AutoSizer disableWidth>
                {({ height }: { height: number }) => (
                  <FixedSizeList
                    height={height}
                    width={totalWidth}
                    itemCount={sortedData.length}
                    itemSize={ROW_HEIGHT}
                    overscanCount={5}
                  >
                    {Row}
                  </FixedSizeList>
                )}
              </AutoSizer>
            </Box>
          </Paper>
        </Box>
      </Container>
    </Box>
  );
};

export default App;
