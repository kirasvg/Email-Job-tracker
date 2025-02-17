'use client';

import { useSession, signIn, signOut } from "next-auth/react";
import { useEffect, useState, useMemo } from "react";
import Image from "next/image";

type Status = 'All' | 'Applied' | 'Application Received' | 'Interview' | 'Rejected' | 'Offer';
type SortField = 'date' | 'company';
type SortOrder = 'asc' | 'desc';

interface JobEmail {
  id: string;
  companyName: string;
  jobProfile: string;
  applicationStatus: Status;
  date: string;
  from: string;
}

const SkeletonCard = () => (
  <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6 animate-pulse">
    <div className="space-y-4">
      <div>
        <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-3/4"></div>
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2 mt-2"></div>
      </div>
      <div className="flex items-center justify-between">
        <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-24"></div>
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-20"></div>
      </div>
      <div className="pt-2 border-t border-gray-100 dark:border-gray-700">
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-2/3"></div>
      </div>
    </div>
  </div>
);

const SkeletonStats = () => (
  <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-sm">
    <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-24 mb-2"></div>
    <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-16"></div>
  </div>
);

const LoadingSpinner = () => (
  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
    <circle 
      className="opacity-25" 
      cx="12" 
      cy="12" 
      r="10" 
      stroke="currentColor" 
      strokeWidth="4" 
      fill="none" 
    />
    <path 
      className="opacity-75" 
      fill="currentColor" 
      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" 
    />
  </svg>
);

const InitialLoadingState = () => (
  <div className="flex items-center justify-center min-h-screen">
    <div className="text-center space-y-4">
      <LoadingSpinner />
      <p className="text-gray-600 dark:text-gray-300">Loading your applications...</p>
    </div>
  </div>
);

export default function Home() {
  const { data: session } = useSession();
  const [jobEmails, setJobEmails] = useState<JobEmail[]>([]);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<Status>('All');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<SortField>('date');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [lastFetchTime, setLastFetchTime] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (session) {
      const initialize = async () => {
        setInitialLoading(true);
        try {
          await loadSavedEmails();
          await fetchEmails();
        } catch (error) {
          setError(error instanceof Error ? error.message : 'Failed to initialize');
        } finally {
          setInitialLoading(false);
        }
        setupNotifications();
      };
      initialize();
    }
  }, [session]);

  useEffect(() => {
    if (!session) return;

    const pollInterval = 5 * 60 * 1000; // 5 minutes
    const intervalId = setInterval(checkNewEmails, pollInterval);
    return () => clearInterval(intervalId);
  }, [session, lastFetchTime]);

  useEffect(() => {
    if (jobEmails.length > 0) {
      localStorage.setItem('jobEmails', JSON.stringify(jobEmails));
    }
  }, [jobEmails]);

  const loadSavedEmails = async () => {
    const savedEmails = localStorage.getItem('jobEmails');
    if (savedEmails) {
      setJobEmails(JSON.parse(savedEmails));
    }
  };

  const setupNotifications = () => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  };

  const checkNewEmails = async () => {
    if (!session || loading) return;

    try {
      const response = await fetch('/api/gmail/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lastFetchTime }),
      });

      if (!response.ok) {
        throw new Error('Failed to fetch new emails');
      }

      const newEmails = await response.json();
      
      if (newEmails.length > 0) {
        updateEmailsWithNewData(newEmails);
        showNotification(newEmails.length);
      }
    } catch (error) {
      console.error('Error checking new emails:', error);
      setError(error instanceof Error ? error.message : 'Failed to check new emails');
    }
  };

  const updateEmailsWithNewData = (newEmails: JobEmail[]) => {
    setJobEmails(prev => {
      const combined = [...newEmails, ...prev];
      return Array.from(new Map(combined.map(item => [item.id, item])).values());
    });
    setLastFetchTime(Date.now());
  };

  const showNotification = (count: number) => {
    if (Notification.permission === "granted") {
      new Notification("New Job Applications", {
        body: `You have ${count} new job application${count > 1 ? 's' : ''}`,
      });
    }
  };

  const fetchEmails = async () => {
    if (!session) return;
    
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/gmail');
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch emails');
      }
      
      setJobEmails(data);
      setLastFetchTime(Date.now());
    } catch (error) {
      console.error('Error fetching emails:', error);
      setError(error instanceof Error ? error.message : 'Failed to fetch emails');
    } finally {
      setLoading(false);
    }
  };

  const statusCounts = useMemo(() => {
    return jobEmails.reduce((acc: Record<string, number>, email) => {
      acc[email.applicationStatus] = (acc[email.applicationStatus] || 0) + 1;
      return acc;
    }, {});
  }, [jobEmails]);

  const filteredAndSortedEmails = useMemo(() => {
    return jobEmails
      .filter(email => {
        const matchesStatus = statusFilter === 'All' || email.applicationStatus === statusFilter;
        const matchesSearch = !searchTerm || 
          email.companyName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
          email.jobProfile?.toLowerCase().includes(searchTerm.toLowerCase());
        return matchesStatus && matchesSearch;
      })
      .sort((a, b) => {
        if (sortBy === 'date') {
          const dateA = new Date(a.date).getTime();
          const dateB = new Date(b.date).getTime();
          return sortOrder === 'desc' ? dateB - dateA : dateA - dateB;
        }
        return sortOrder === 'desc'
          ? b.companyName.localeCompare(a.companyName)
          : a.companyName.localeCompare(b.companyName);
      });
  }, [jobEmails, statusFilter, searchTerm, sortBy, sortOrder]);

  const getStatusColor = (status: Status) => {
    const colors = {
      Rejected: 'bg-red-100 text-red-800',
      Interview: 'bg-blue-100 text-blue-800',
      Offer: 'bg-green-100 text-green-800',
      Applied: 'bg-yellow-100 text-yellow-800',
      'Application Received': 'bg-purple-100 text-purple-800'
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
  };

  if (!session) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 p-4">
        <div className="text-center space-y-6 max-w-md">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white">Job Application Tracker</h1>
          <p className="text-lg text-gray-600 dark:text-gray-300">
            Keep track of your job applications in one place
          </p>
          <button
            onClick={() => signIn('google')}
            className="inline-flex items-center gap-3 px-8 py-4 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-lg hover:shadow-xl transition-all duration-200 border border-gray-200 dark:border-gray-700"
          >
            <Image
              src="/logo.png"
              alt="Google logo"
              width={24}
              height={24}
              className="w-6 h-6"
            />
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  if (initialLoading) {
    return <InitialLoadingState />;
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <header className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4 mb-6">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-4">
              {session.user?.image && (
                <Image
                  src={session.user.image}
                  alt="Profile"
                  width={48}
                  height={48}
                  className="rounded-full"
                />
              )}
              <div>
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                  {session.user?.name}
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {session.user?.email}
                </p>
              </div>
            </div>
            <div className="flex gap-4">
              <button
                onClick={fetchEmails}
                disabled={loading}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-all duration-200 flex items-center gap-2 shadow-sm"
              >
                {loading ? (
                  <>
                    <LoadingSpinner />
                    <span>Refreshing...</span>
                  </>
                ) : (
                  'Refresh'
                )}
              </button>
              <button
                onClick={() => signOut()}
                className="px-6 py-2 text-gray-600 hover:text-gray-800 transition-colors"
              >
                Sign out
              </button>
            </div>
          </div>
        </header>

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-100 text-red-800 rounded-lg">
            {error}
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {loading && !jobEmails.length ? (
            Array(4).fill(0).map((_, index) => (
              <SkeletonStats key={index} />
            ))
          ) : (
            Object.entries(statusCounts).map(([status, count]) => (
              <div key={status} 
                className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-sm hover:shadow-md transition-shadow">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Total {status}
                </p>
                <p className="text-3xl font-bold text-gray-900 dark:text-white mt-1">
                  {count}
                </p>
              </div>
            ))
          )}
        </div>

        {/* Filters */}
        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-sm mb-6">
          <div className="flex flex-wrap gap-4 items-center justify-between">
            <div className="flex gap-4 items-center">
              <input
                type="text"
                placeholder="Search companies or roles..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                disabled={loading}
              />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as Status)}
                className="px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                disabled={loading}
              >
                <option value="All">All Status</option>
                {Object.entries(statusCounts).map(([status, count]) => (
                  <option key={status} value={status}>
                    {status} ({count})
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-4 items-center">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortField)}
                className="px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                disabled={loading}
              >
                <option value="date">Sort by Date</option>
                <option value="company">Sort by Company</option>
              </select>
              <button
                onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                disabled={loading}
              >
                {sortOrder === 'asc' ? '↑' : '↓'}
              </button>
            </div>
          </div>
        </div>

        {/* Job Applications Grid */}
        <div className="space-y-6">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            Job Applications ({loading ? '...' : filteredAndSortedEmails.length})
          </h2>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {loading && !jobEmails.length ? (
              Array(6).fill(0).map((_, index) => (
                <SkeletonCard key={index} />
              ))
            ) : filteredAndSortedEmails.length > 0 ? (
              filteredAndSortedEmails.map((email) => (
                <div
                  key={email.id}
                  className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6 hover:shadow-md transition-all duration-200"
                >
                  <div className="space-y-4">
                    <div>
                      <h3 className="font-semibold text-gray-900 dark:text-white text-lg">
                        {email.companyName}
                      </h3>
                      <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                        {email.jobProfile}
                      </p>
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(email.applicationStatus)}`}>
                        {email.applicationStatus}
                      </span>
                      <span className="text-sm text-gray-400">
                        {new Date(email.date).toLocaleDateString()}
                      </span>
                    </div>

                    <div className="pt-2 border-t border-gray-100 dark:border-gray-700">
                      <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                        From: {email.from}
                      </p>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="col-span-full text-center py-12">
                <p className="text-gray-500 dark:text-gray-400">
                  {searchTerm || statusFilter !== 'All' 
                    ? 'No applications match your filters' 
                    : 'No applications found. They will appear here once processed.'}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Loading Overlay for Subsequent Fetches */}
        {loading && jobEmails.length > 0 && (
          <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-xl">
              <div className="flex items-center space-x-3">
                <LoadingSpinner />
                <p className="text-gray-700 dark:text-gray-300">Refreshing data...</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}