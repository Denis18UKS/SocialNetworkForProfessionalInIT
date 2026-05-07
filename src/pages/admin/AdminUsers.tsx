import { useEffect, useState, useMemo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useReactTable,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  SortingState,
  ColumnFiltersState,
  flexRender,
} from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Check, X, Search } from "lucide-react";
import { motion } from "framer-motion";
import { useToast } from "@/components/ui/use-toast";


interface User {
  id: string;
  username: string;
  email: string;
  isBlocked: "активен" | "заблокирован";
  reason_blocked?: string;
}

const statusBadgeVariants = {
  активен: "bg-green-100 text-green-800",
  заблокирован: "bg-red-100 text-red-800",
};

export default function AdminUsers() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [blockModalOpen, setBlockModalOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [blockReason, setBlockReason] = useState("");
  const { toast } = useToast();

  const [blockingUserId, setBlockingUserId] = useState<string | null>(null);
  const [unblockingUserId, setUnblockingUserId] = useState<string | null>(null);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const response = await fetch("http://localhost:5000/admin/users", {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
      });
      if (response.ok) {
        const data = await response.json();
        setUsers(data);
      }
    } catch (error) {
      toast({
        title: "Ошибка",
        description: "Не удалось загрузить пользователей",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const openBlockModal = (userId: string) => {
    setSelectedUserId(userId);
    setBlockReason("");
    setBlockModalOpen(true);
  };

  const closeBlockModal = () => {
    setBlockModalOpen(false);
  };

  const handleConfirmBlockUser = async () => {
    if (!selectedUserId) return;

    setBlockingUserId(selectedUserId);
    try {
      await fetch(`http://localhost:5000/users/${selectedUserId}/block`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({ reason: blockReason }),
      });
      toast({
        title: "Успех",
        description: "Пользователь заблокирован",
      });
      closeBlockModal();
      fetchUsers();
    } catch (error) {
      toast({
        title: "Ошибка",
        description: "Не удалось заблокировать пользователя",
        variant: "destructive",
      });
    } finally {
      setBlockingUserId(null);
    }
  };

  const handleUnBlockUser = async (userId: string) => {
    setUnblockingUserId(userId);
    try {
      await fetch(`http://localhost:5000/users/${userId}/unblock`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
      });
      toast({
        title: "Успех",
        description: "Пользователь разблокирован",
      });
      fetchUsers();
    } catch (error) {
      toast({
        title: "Ошибка",
        description: "Не удалось разблокировать пользователя",
        variant: "destructive",
      });
    } finally {
      setUnblockingUserId(null);
    }
  };

  const columns = useMemo(
    () => [
      {
        accessorKey: "username",
        header: "Имя пользователя",
        cell: ({ row }) => (
          <div className="font-medium">{row.original.username}</div>
        ),
      },
      {
        accessorKey: "email",
        header: "Email",
      },
      {
        accessorKey: "isBlocked",
        header: "Статус",
        cell: ({ row }) => (
          <Badge className={statusBadgeVariants[row.original.isBlocked]}>
            {row.original.isBlocked}
          </Badge>
        ),
      },
      {
        accessorKey: "reason_blocked",
        header: "Причина блокировки",
        cell: ({ row }) => (
          <div className="text-sm text-gray-500">
            {row.original.isBlocked === "заблокирован"
              ? row.original.reason_blocked || "—"
              : "—"}
          </div>
        ),
      },
      {
        accessorKey: "actions",
        header: "Действия",
        cell: ({ row }) => (
          <div className="flex gap-2">
            {row.original.isBlocked === "активен" ? (
              <Button
                size="sm"
                variant="destructive"
                onClick={() => openBlockModal(row.original.id)}
                disabled={blockingUserId === row.original.id}
              >
                {blockingUserId === row.original.id ? (
                  <div className="flex items-center">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Загрузка...
                  </div>
                ) : (
                  <>
                    <X className="h-4 w-4 mr-1" />
                    Заблокировать
                  </>
                )}
              </Button>
            ) : (
              <Button
                size="sm"
                className="bg-green-600 hover:bg-green-700 text-white"
                onClick={() => handleUnBlockUser(row.original.id)}
                disabled={unblockingUserId === row.original.id}
              >
                {unblockingUserId === row.original.id ? (
                  <div className="flex items-center">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Загрузка...
                  </div>
                ) : (
                  <>
                    <Check className="h-4 w-4 mr-1" />
                    Разблокировать
                  </>
                )}
              </Button>
            )}
          </div>
        ),
      }
    ],
    []
  );

  const table = useReactTable({
    data: users,
    columns,
    state: {
      sorting,
      columnFilters,
      globalFilter,
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    globalFilterFn: (row, columnId, filterValue) => {
      const username = String(row.getValue("username")).toLowerCase();
      const email = String(row.getValue("email")).toLowerCase();
      return (
        username.includes(filterValue.toLowerCase()) ||
        email.includes(filterValue.toLowerCase())
      );
    },
  });

  const filteredUsers = table.getRowModel().rows;
  const pageCount = table.getPageCount();
  const currentPage = table.getState().pagination.pageIndex + 1;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className="container mx-auto py-6 space-y-6"
    >
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <h1 className="text-2xl font-bold">Управление пользователями</h1>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Поиск..."
              className="pl-9"
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
            />
          </div>

          <Select
            value={columnFilters.find((f) => f.id === "isBlocked")?.value as string || "все"}
            onValueChange={(value) => {
              setColumnFilters(
                value === "все" ? [] : [{ id: "isBlocked", value }]
              );
            }}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Статус" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="все">Все статусы</SelectItem>
              <SelectItem value="активен">Активные</SelectItem>
              <SelectItem value="заблокирован">Заблокированные</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Пользователи</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center items-center h-32">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-400" />
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="py-8 text-center text-gray-500">
              Пользователи не найдены
            </div>
          ) : (
            <div className="rounded-lg border shadow-sm overflow-hidden">
              <Table>
                <TableHeader className="bg-gray-50 dark:bg-gray-800">
                  {table.getHeaderGroups().map((headerGroup) => (
                    <TableRow key={headerGroup.id}>
                      {headerGroup.headers.map((header) => (
                        <TableHead key={header.id}>
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                        </TableHead>
                      ))}
                    </TableRow>
                  ))}
                </TableHeader>
                <TableBody>
                  {filteredUsers.map((row) => (
                    <TableRow key={row.id} className="hover:bg-gray-50">
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
        <CardFooter className="flex justify-between items-center">
          <div className="text-sm text-gray-500">
            Показано {filteredUsers.length} из {users.length} пользователей
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              Назад
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              Вперед
            </Button>
          </div>
        </CardFooter>
      </Card>

      {blockModalOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
          onClick={closeBlockModal}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white rounded-lg p-6 w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-xl font-bold mb-4">Причина блокировки</h2>
            <textarea
              className="w-full border rounded p-2 mb-4"
              rows={4}
              placeholder="Введите причину блокировки..."
              value={blockReason}
              onChange={(e) => setBlockReason(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={closeBlockModal}>
                Отмена
              </Button>
              <Button
                variant="destructive"
                disabled={!blockReason.trim()}
                onClick={handleConfirmBlockUser}
              >
                Заблокировать
              </Button>
            </div>
          </motion.div>
        </div>
      )}
    </motion.div>
  );
}