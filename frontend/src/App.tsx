import React, {
  useEffect,
  useState,
  useMemo,
  useRef,
  useCallback,
  useTransition,
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

// Cloudflare R2 URL (from dashboard)
const CLOUDFLARE_R2_URL =
  "https://pub-d6df37eab3344b629761df0b66b2840d.r2.dev/merged_df.csv";
const CSV_URL = CLOUDFLARE_R2_URL;
console.log("Using Cloudflare R2 URL:", CSV_URL);

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
const MIN_COL_WIDTH = 80;
const RESIZE_HANDLE_WIDTH = 10; // Wider handle for easier grabbing

const getColumnWidths = (
  columns: string[],
  containerWidth: number,
  customWidths: Record<string, number> = {}
) => {
  // First apply custom widths if they exist
  const baseWidths = columns.reduce((acc, col) => {
    acc[col] = customWidths[col] || DEFAULT_COL_WIDTH;
    return acc;
  }, {} as Record<string, number>);

  // If total columns would be less than container, expand to fill
  // but only for columns that don't have custom widths
  const calculatedWidth = columns.reduce(
    (sum, col) => sum + (customWidths[col] || DEFAULT_COL_WIDTH),
    0
  );

  if (calculatedWidth < containerWidth && columns.length > 0) {
    // Count columns without custom width
    const columnsWithoutCustomWidth = columns.filter(
      (col) => !customWidths[col]
    );

    if (columnsWithoutCustomWidth.length > 0) {
      // Calculate remaining space
      const remainingSpace =
        containerWidth -
        columns.reduce((sum, col) => sum + (customWidths[col] || 0), 0);

      // Distribute remaining space among columns without custom width
      const extraWidth = Math.floor(
        remainingSpace / columnsWithoutCustomWidth.length
      );

      columnsWithoutCustomWidth.forEach((col) => {
        baseWidths[col] = extraWidth;
      });
    }
  }

  return baseWidths;
};

// Ensure padding is consistent between header and cell
const CELL_PADDING_X = 16; // px
const CELL_PADDING_Y = 8; // px

const ROW_HEIGHT = 48;

// Fix borders to ensure precise alignment
const borderFixStyles = {
  boxSizing: "border-box" as const,
  borderLeft: "none",
  borderTop: "none",
};

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
  // Custom column widths for resizing
  const [customColumnWidths, setCustomColumnWidths] = useState<
    Record<string, number>
  >({});
  const [resizingColumn, setResizingColumn] = useState<string | null>(null);
  const [resizeStartX, setResizeStartX] = useState<number>(0);
  const [initialWidth, setInitialWidth] = useState<number>(0);
  // Track whether we're currently resizing (for cursor styling)
  const [isResizing, setIsResizing] = useState(false);
  // Add state for hovering column to improve the UX
  const [hoveringColumn, setHoveringColumn] = useState<string | null>(null);

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
  // Add isPending states for transitions to keep UI responsive
  const [isPending, startTransition] = useTransition();

  // Add debounced searches with optimized delays and trimming
  const debouncedSearch = useDebounce(search, 600);
  const trimmedSearch = useMemo(
    () => debouncedSearch.trim(),
    [debouncedSearch]
  );

  // Reduced debounce delays for UI search fields to make them more responsive
  const debouncedFilterColSearch = useDebounce(filterColSearch, 150);
  const trimmedFilterColSearch = useMemo(
    () => debouncedFilterColSearch.trim(),
    [debouncedFilterColSearch]
  );

  const debouncedColumnSelectSearch = useDebounce(columnSelectSearch, 150);
  const trimmedColumnSelectSearch = useMemo(
    () => debouncedColumnSelectSearch.trim(),
    [debouncedColumnSelectSearch]
  );

  // Memoize the column type guessing function
  const guessColumnType = useCallback(
    (col: string, data: Row[]): "number" | "date" | "string" => {
      // Always treat funding_total as a number
      if (col === "funding_total") return "number";

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
    setLoading(true);

    fetch(CSV_URL)
      .then((response) => {
        console.log("Response status:", response.status);
        if (!response.ok) {
          throw new Error(`Network error: ${response.status}`);
        }
        return response.text();
      })
      .then((csvText) => {
        // Add log to check CSV text
        console.log(
          "CSV data loaded, first 100 chars:",
          csvText.substring(0, 100)
        );

        Papa.parse(csvText, {
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
      })
      .catch((error) => {
        console.error("Failed to load CSV:", error);
        setLoading(false);
      });
  }, []);

  // Add memoized parsed website data to avoid parsing on every filter operation
  const parsedWebsiteData = useMemo(() => {
    const cache: Record<
      string,
      { domain?: string; url?: string; raw: string }
    > = {};

    // Log parsing results for debugging
    let parsingSuccesses = 0;
    let parsingFailures = 0;

    // Sample some raw website data to understand its format
    const sampleCount = Math.min(10, data.length);
    console.log(`Examining ${sampleCount} website samples:`);

    for (let i = 0; i < sampleCount; i++) {
      if (data[i] && data[i].website) {
        console.log(`Sample ${i}:`, data[i].website);
      }
    }

    data.forEach((row) => {
      if (row.website) {
        try {
          // Try parsing the JSON
          let parsed;
          try {
            parsed = JSON.parse(row.website);
          } catch (jsonError) {
            // If JSON parsing fails, try to parse it as a raw domain string
            const domainMatch = /^(?:https?:\/\/)?(?:www\.)?([^\/]+)/.exec(
              row.website
            );
            if (domainMatch) {
              parsed = { domain: domainMatch[1], url: row.website };
              console.log("Extracted domain from URL string:", parsed.domain);
            } else {
              // Just use it as a raw string
              parsed = { domain: row.website, url: row.website };
            }
          }

          // Normalize domain - ensure lowercase and no www. prefix
          let domain = (parsed.domain || "").toLowerCase();
          if (domain.startsWith("www.")) {
            domain = domain.substring(4);
          }

          // Store normalized values
          cache[row.id] = {
            domain,
            url: (parsed.url || "").toLowerCase(),
            raw: row.website.toLowerCase(),
          };

          parsingSuccesses++;

          // Log sample of successful parses for domains with dots
          if (domain && domain.includes(".") && parsingSuccesses < 10) {
            console.log(
              "Successfully parsed domain with dot:",
              domain,
              "from:",
              row.website
            );
          }
        } catch (e) {
          parsingFailures++;
          // Store raw data for fallback searching
          cache[row.id] = { raw: row.website.toLowerCase() };
        }
      }
    });

    console.log(
      `Website parsing: ${parsingSuccesses} successes, ${parsingFailures} failures`
    );

    return cache;
  }, [data]);

  // Filtering logic - optimized to reduce work during typing
  const filteredData = useMemo(() => {
    // Skip all filtering if no search term and no filters - return all data
    if (!trimmedSearch && (!activeFilters || activeFilters.length === 0)) {
      return data;
    }

    let filtered = data;

    // Only apply filtering when we have a debounced search value
    if (trimmedSearch) {
      const lower = trimmedSearch.toLowerCase();

      // Add debug logging to see what we're searching for
      console.log("Searching for:", lower);

      // The simplest approach - just search the raw data
      filtered = filtered.filter((row) => {
        // Check if company name contains the search string (always do this)
        if (row.name && row.name.toLowerCase().includes(lower)) {
          return true;
        }

        // For website, just do a direct string search on the raw field
        if (row.website && row.website.toLowerCase().includes(lower)) {
          console.log("Website match found:", row.website);
          return true;
        }

        return false;
      });
    }

    // Only apply advanced filters if there are any
    if (activeFilters && activeFilters.length > 0) {
      // Apply each filter
      activeFilters.forEach((f) => {
        filtered = filtered.filter((row) => {
          const val = row[f.col];

          // Special handling for funding_total column
          if (f.col === "funding_total" && f.colType === "number") {
            // Remove currency symbols, commas, etc. and parse as number
            const cleanVal = val ? val.replace(/[^0-9.-]+/g, "") : "0";
            const num = Number(cleanVal);
            const filterVal = Number(f.value);
            const filterVal2 = f.value2 ? Number(f.value2) : 0;

            if (f.type === "equals") return num === filterVal;
            if (f.type === "gt") return num > filterVal;
            if (f.type === "lt") return num < filterVal;
            if (f.type === "range")
              return num >= filterVal && num <= filterVal2;

            return true;
          }

          // Special handling for website column - use direct string search
          if (f.col === "website") {
            if (f.type === "contains") {
              const searchVal = (f.value || "").toLowerCase();
              return (
                row.website && row.website.toLowerCase().includes(searchVal)
              );
            }
          }

          // Original logic for other columns
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
    }

    return filtered;
  }, [data, trimmedSearch, activeFilters]);

  // Sorting logic - optimize with a stable sort and memoization
  const sortedData = useMemo(() => {
    // Return filtered data directly if no sorting is needed
    if (!orderBy) return filteredData;

    // Use a stable sorting algorithm with memoization
    const timeStart = performance.now();

    // Create a sorted copy
    const sorted = [...filteredData].sort((a, b) => {
      // Get values and handle empty cases
      const aVal = a[orderBy] || "";
      const bVal = b[orderBy] || "";

      // Check if numeric comparison is possible
      if (!isNaN(Number(aVal)) && !isNaN(Number(bVal))) {
        return order === "asc"
          ? Number(aVal) - Number(bVal)
          : Number(bVal) - Number(aVal);
      }

      // Default to string comparison
      return order === "asc"
        ? String(aVal).localeCompare(String(bVal))
        : String(bVal).localeCompare(String(aVal));
    });

    console.log(`Sorting took ${performance.now() - timeStart}ms`);
    return sorted;
  }, [filteredData, orderBy, order]);

  // Memoize displayed columns computation
  const displayedColumns = useMemo(
    () => columnOrder.filter((col) => visibleColumns.includes(col)),
    [columnOrder, visibleColumns]
  );

  // Use window width state to trigger recalculation
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);

  // Update window width on resize
  useEffect(() => {
    const handleResize = () => {
      setWindowWidth(window.innerWidth);
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  // Memoize column widths
  const columnWidths = useMemo(
    () =>
      getColumnWidths(displayedColumns, windowWidth - 80, customColumnWidths),
    [displayedColumns, windowWidth, customColumnWidths]
  );

  const totalWidth = useMemo(
    () =>
      Math.max(
        displayedColumns.reduce((sum, col) => sum + columnWidths[col], 0),
        windowWidth - 80
      ),
    [displayedColumns, columnWidths, windowWidth]
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

  // Improved column resizing handlers
  const handleResizeStart = useCallback(
    (e: React.MouseEvent, column: string) => {
      e.preventDefault();
      e.stopPropagation();

      // Prevent triggering sort when starting resize
      e.nativeEvent.stopImmediatePropagation();

      // Calculate current width directly instead of using state which might be stale
      const currentWidth = columnWidths[column];
      const startX = e.clientX;

      setResizingColumn(column);
      setResizeStartX(startX);
      setInitialWidth(currentWidth);
      setIsResizing(true);

      // Add resize styling to the body to maintain cursor during resize
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const handleMove = (moveEvent: MouseEvent) => {
        const diff = moveEvent.clientX - startX;
        const newWidth = Math.max(currentWidth + diff, MIN_COL_WIDTH);

        setCustomColumnWidths((prev) => ({
          ...prev,
          [column]: newWidth,
        }));
      };

      const handleUp = (upEvent: MouseEvent) => {
        setResizingColumn(null);
        setIsResizing(false);

        // Restore default cursor and selection
        document.body.style.cursor = "";
        document.body.style.userSelect = "";

        document.removeEventListener("mousemove", handleMove);
        document.removeEventListener("mouseup", handleUp);
      };

      // Add listeners directly within this function to avoid dependency issues
      document.addEventListener("mousemove", handleMove);
      document.addEventListener("mouseup", handleUp);
    },
    [columnWidths]
  );

  // Track column hover for better resize handle visibility
  const handleColumnMouseEnter = useCallback(
    (column: string) => {
      if (!isResizing) {
        setHoveringColumn(column);
      }
    },
    [isResizing]
  );

  const handleColumnMouseLeave = useCallback(() => {
    if (!isResizing) {
      setHoveringColumn(null);
    }
  }, [isResizing]);

  // Simplified cleanup - we no longer need this effect
  useEffect(() => {
    return () => {
      // Just clean up global state in case component unmounts during resize
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.body.classList.remove("resizing");
    };
  }, []);

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
        value:
          typeof filterValue === "string" ? filterValue.trim() : filterValue,
        value2:
          typeof filterValue2 === "string" ? filterValue2.trim() : filterValue2,
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

  // Virtualized row - wrap with React.memo to prevent unnecessary rerenders
  const Row = React.memo(
    ({ index, style }: { index: number; style: React.CSSProperties }) => {
      const row = sortedData[index];
      if (!row) return null;

      return (
        <div
          style={{
            ...style,
            display: "flex",
            width: "100%",
            minWidth: totalWidth,
            boxSizing: "border-box",
          }}
        >
          {displayedColumns.map((header, colIdx) => (
            <div
              key={`cell-${header}-${index}`}
              style={{
                width: columnWidths[header],
                minWidth: columnWidths[header],
                maxWidth: columnWidths[header],
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                paddingLeft: CELL_PADDING_X,
                paddingRight: CELL_PADDING_X,
                paddingTop: CELL_PADDING_Y,
                paddingBottom: CELL_PADDING_Y,
                display: "flex",
                alignItems: "center",
                borderBottom: "1px solid #f0f0f0",
                borderRight:
                  colIdx === displayedColumns.length - 1
                    ? "none"
                    : "1px solid #eee",
                backgroundColor: "#fff",
                color: "#111",
                fontSize: 15,
                ...borderFixStyles,
              }}
              title={row[header]}
            >
              {row[header]}
            </div>
          ))}
        </div>
      );
    }
  );

  // Add refs for header and body scroll containers
  const headerRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<FixedSizeList>(null);

  // Add a new ref for the outer scroll container
  const outerScrollContainerRef = useRef<HTMLDivElement>(null);

  // Debug output
  console.log("Data length:", sortedData.length);
  console.log("Display columns:", displayedColumns.length);

  // Sync scrolling between header and body - using a more direct approach for virtualization
  useEffect(() => {
    const bodyElement = bodyRef.current;
    const headerElement = headerRef.current;

    if (!bodyElement || !headerElement) return;

    const handleBodyScroll = () => {
      // Only sync horizontal scrolling
      headerElement.scrollLeft = bodyElement.scrollLeft;
    };

    // Add scroll event listener
    bodyElement.addEventListener("scroll", handleBodyScroll);

    return () => {
      bodyElement.removeEventListener("scroll", handleBodyScroll);
    };
  }, []);

  // Add CSS to head for global styles
  useEffect(() => {
    const style = document.createElement("style");
    style.innerHTML = `
      .resizing * {
        cursor: col-resize !important;
      }
      
      @keyframes pulse {
        0% { background-color: rgba(25, 118, 210, 0.4); }
        50% { background-color: rgba(25, 118, 210, 0.6); }
        100% { background-color: rgba(25, 118, 210, 0.4); }
      }
    `;
    document.head.appendChild(style);
    return () => {
      document.head.removeChild(style);
    };
  }, []);

  // Add global resize styling class
  useEffect(() => {
    if (isResizing) {
      document.body.classList.add("resizing");
    } else {
      document.body.classList.remove("resizing");
    }

    return () => {
      document.body.classList.remove("resizing");
    };
  }, [isResizing]);

  // Add a ref for the search input to optimize its performance
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Optimize search input handlers with memoized callbacks
  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearch(e.target.value);
    },
    []
  );

  const handleColumnSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setColumnSelectSearch(value);
      // Use transition for non-critical UI updates to keep the interface responsive
      startTransition(() => {
        // Any heavy computations related to this change can go here
      });
    },
    []
  );

  const handleFilterColSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setFilterColSearch(value);
      // Use transition for non-critical UI updates
      startTransition(() => {
        // Any heavy computations related to this change can go here
      });
    },
    []
  );

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
            label="Search for company"
            variant="outlined"
            size="small"
            value={search}
            onChange={handleSearchChange}
            sx={{ flex: 1, bgcolor: "#fff" }}
            InputLabelProps={{ style: { color: "#222" } }}
            inputProps={{
              style: { color: "#111" },
              ref: searchInputRef,
              // Optimize the input to reduce render bottlenecks
              autoComplete: "off",
              spellCheck: "false",
            }}
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
            <Box px={2} pb={1} sx={{ width: 300 }}>
              <TextField
                label="Search columns"
                value={columnSelectSearch}
                onChange={handleColumnSearchChange}
                onKeyDown={(e) => e.stopPropagation()}
                autoFocus
                fullWidth
                size="small"
                InputProps={{
                  endAdornment: isPending ? (
                    <CircularProgress size={16} thickness={4} sx={{ mr: 1 }} />
                  ) : null,
                }}
                inputProps={{
                  autoComplete: "off",
                  spellCheck: "false",
                }}
              />
            </Box>
            <DragDropContext onDragEnd={onDragEnd}>
              <Droppable droppableId="columns-droppable">
                {(provided) => (
                  <Box
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    sx={{
                      maxHeight: "50vh",
                      overflow: "auto",
                      "&::-webkit-scrollbar": {
                        width: "8px",
                      },
                      "&::-webkit-scrollbar-thumb": {
                        backgroundColor: "rgba(0,0,0,0.2)",
                        borderRadius: "4px",
                      },
                    }}
                  >
                    {/* Use a memoized filtered column list */}
                    {useMemo(() => {
                      // Apply filter first to improve performance
                      const filteredColumns = columnOrder.filter((col) =>
                        col
                          .toLowerCase()
                          .includes(trimmedColumnSelectSearch.toLowerCase())
                      );

                      // Only map the filtered list
                      return filteredColumns.map((col, idx) => (
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
                                padding: "4px 16px",
                              }}
                            >
                              <Checkbox
                                checked={visibleColumns.includes(col)}
                                onChange={() => handleToggleColumn(col)}
                                size="small"
                              />
                              <ListItemText
                                primary={col}
                                primaryTypographyProps={{
                                  style: {
                                    fontSize: "14px",
                                    whiteSpace: "nowrap",
                                  },
                                }}
                              />
                            </MenuItem>
                          )}
                        </Draggable>
                      ));
                    }, [
                      columnOrder,
                      trimmedColumnSelectSearch,
                      visibleColumns,
                    ])}
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
        <Dialog
          open={filterModalOpen}
          onClose={handleCloseFilter}
          PaperProps={{
            sx: {
              maxWidth: "95vw",
              width: "auto",
              maxHeight: "90vh",
              margin: "48px auto", // Add more top margin
            },
          }}
        >
          <DialogTitle sx={{ pb: 2, pt: 3 }}>Add Filter</DialogTitle>
          <DialogContent sx={{ pt: 3, pb: 3, px: 3 }}>
            <Stack spacing={3} minWidth={300} marginTop={"5px"}>
              {/* Column search */}
              <TextField
                label="Search columns"
                value={filterColSearch}
                onChange={handleFilterColSearchChange}
                fullWidth
                size="small"
                sx={{ mb: 1, mt: 0 }}
                InputLabelProps={{
                  shrink: true,
                  sx: { backgroundColor: "white", px: 1 },
                }}
                InputProps={{
                  endAdornment: isPending ? (
                    <CircularProgress size={16} thickness={4} sx={{ mr: 1 }} />
                  ) : null,
                }}
                inputProps={{
                  autoComplete: "off",
                  spellCheck: "false",
                }}
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
                  MenuProps={{
                    PaperProps: {
                      style: {
                        maxHeight: 300,
                      },
                    },
                  }}
                >
                  {/* Use a memoized filtered column list for better performance */}
                  {useMemo(() => {
                    // Get filtered columns first to reduce rendering operations
                    const filteredColumns = displayedColumns.filter((col) =>
                      col
                        .toLowerCase()
                        .includes(trimmedFilterColSearch.toLowerCase())
                    );

                    return filteredColumns.map((col) => (
                      <MuiMenuItem
                        key={col}
                        value={col}
                        sx={{ fontSize: "14px", py: 0.5 }}
                      >
                        {col}
                      </MuiMenuItem>
                    ));
                  }, [displayedColumns, trimmedFilterColSearch])}
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
                              onChange={(e) => {
                                // Allow spaces during typing
                                setFilterValue(e.target.value);
                              }}
                            />
                            <TextField
                              label="Max"
                              type="number"
                              value={filterValue2}
                              onChange={(e) => {
                                // Allow spaces during typing
                                setFilterValue2(e.target.value);
                              }}
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
              borderRadius: 3,
              boxShadow: 2,
              display: "flex",
              flexDirection: "column",
              flex: 1,
              minHeight: 0,
              overflow: "hidden",
            }}
          >
            {/* Main scrollable container */}
            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                flex: 1,
                overflow: "hidden",
                width: "100%",
              }}
            >
              {/* Header (sticky) */}
              <Box
                sx={{
                  borderBottom: "2px solid #eee",
                  position: "sticky",
                  top: 0,
                  zIndex: 2,
                  bgcolor: "#fff",
                  width: "100%",
                  overflow: "hidden",
                  boxSizing: "border-box",
                }}
                ref={headerRef}
              >
                <Box
                  sx={{
                    display: "flex",
                    width: "100%",
                    minWidth: totalWidth,
                    ...borderFixStyles,
                  }}
                >
                  {displayedColumns.map((header: string, idx: number) => (
                    <Box
                      key={header}
                      sx={{
                        width: columnWidths[header],
                        minWidth: columnWidths[header],
                        maxWidth: columnWidths[header],
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        paddingLeft: `${CELL_PADDING_X}px`,
                        paddingRight: `${
                          CELL_PADDING_X + RESIZE_HANDLE_WIDTH
                        }px`, // Add extra padding for resize handle
                        paddingTop: `${CELL_PADDING_Y}px`,
                        paddingBottom: `${CELL_PADDING_Y}px`,
                        color: "#111",
                        fontWeight: 700,
                        display: "flex",
                        alignItems: "center",
                        borderRight:
                          idx === displayedColumns.length - 1
                            ? "none"
                            : "1px solid #eee",
                        cursor: isResizing ? "col-resize" : "pointer",
                        position: "relative",
                        transition: "background-color 0.2s",
                        backgroundColor:
                          isResizing && resizingColumn === header
                            ? "rgba(25, 118, 210, 0.1)"
                            : "#fff",
                        ...borderFixStyles,
                      }}
                      onClick={() => !isResizing && handleSort(header)}
                      onMouseEnter={() => handleColumnMouseEnter(header)}
                      onMouseLeave={handleColumnMouseLeave}
                    >
                      {header}
                      {orderBy === header && (
                        <Box component="span" sx={{ ml: 1, fontSize: 12 }}>
                          {order === "asc" ? "▲" : "▼"}
                        </Box>
                      )}

                      {/* The resize handle - completely reworked for reliability */}
                      <div
                        style={{
                          position: "absolute",
                          right: -3,
                          top: 0,
                          height: "100%",
                          width: "10px",
                          cursor: "col-resize",
                          zIndex: 10,
                          touchAction: "none",
                        }}
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => handleResizeStart(e, header)}
                      >
                        <div
                          style={{
                            position: "absolute",
                            top: "25%",
                            bottom: "25%",
                            left: "50%",
                            width: "2px",
                            transform: "translateX(-50%)",
                            backgroundColor:
                              isResizing && resizingColumn === header
                                ? "#1976d2"
                                : hoveringColumn === header
                                ? "rgba(25, 118, 210, 0.6)"
                                : "rgba(0, 0, 0, 0.1)",
                            borderRadius: "1px",
                          }}
                        />
                      </div>
                    </Box>
                  ))}
                </Box>
              </Box>

              {/* Custom scrollable container that will keep header and body in sync */}
              <Box
                sx={{
                  flex: 1,
                  minHeight: 0,
                  overflowX: "auto", // This container handles horizontal scrolling
                  overflowY: "hidden", // But not vertical
                  width: "100%",
                }}
                ref={bodyRef}
              >
                {/* Use a div with fixed width for all data */}
                <div style={{ width: "100%", minWidth: totalWidth }}>
                  {sortedData.length === 0 ? (
                    <Box sx={{ p: 2, textAlign: "center" }}>
                      No data to display
                    </Box>
                  ) : (
                    <div
                      style={{
                        height: window.innerHeight - 180,
                        width: "100%",
                      }}
                    >
                      {/* The list itself only handles vertical scrolling */}
                      <FixedSizeList
                        height={window.innerHeight - 180}
                        width={totalWidth}
                        itemCount={sortedData.length}
                        itemSize={ROW_HEIGHT}
                        overscanCount={10}
                        style={{ overflow: "hidden auto" }} // Only allow vertical scrolling here
                      >
                        {Row}
                      </FixedSizeList>
                    </div>
                  )}
                </div>
              </Box>
            </Box>
          </Paper>
        </Box>
      </Container>
    </Box>
  );
};

export default App;
