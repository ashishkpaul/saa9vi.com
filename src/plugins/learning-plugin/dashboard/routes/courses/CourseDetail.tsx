import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api, Badge, Button, Card, Input, Label, Table, TableBody, TableCell,
  TableHead, TableHeader, TableRow, Skeleton, Textarea,
} from '@vendure/dashboard';
import type { DashboardRouteDefinition, AnyRoute } from '@vendure/dashboard';
import { toast } from 'sonner';
import { useState } from 'react';
import { graphql } from '@/gql';

const GET_COURSE = graphql(`
  query GetLearningCourse($id: ID!) {
    learningCourse(id: $id) {
      id slug title description status createdAt
      tools { id toolKey order visibility }
      enrollments { id customerId courseRole status enrolledAt }
    }
  }
`);

const UPDATE_COURSE = graphql(`
  mutation UpdateLearningCourse($id: ID!, $input: LearningUpdateCourseInput!) {
    updateLearningCourse(id: $id, input: $input) { id title description }
  }
`);

const ENROLL_LEARNER = graphql(`
  mutation EnrollLearner($input: LearningEnrollLearnerInput!) {
    enrollLearner(input: $input) { id status courseRole }
  }
`);

function CourseDetailPage({ route }: { route: AnyRoute }) {
  const params = route.useParams() as { id: string };
  const id = params.id;
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [enrollCustomerId, setEnrollCustomerId] = useState('');
  const [activeTab, setActiveTab] = useState<'overview' | 'tools' | 'users'>('overview');

  const { data, isLoading } = useQuery({
    queryKey: ['learningCourse', id],
    queryFn: () => api.query(GET_COURSE, { id }),
    enabled: !!id,
  });

  const course = data?.learningCourse;

  // Sync form state when data loads (only once)
  if (course && title === '') {
    setTitle(course.title ?? '');
    setDescription(course.description ?? '');
  }

  const updateMutation = useMutation({
    mutationFn: (input: { title?: string; description?: string }) =>
      api.mutate(UPDATE_COURSE, { id, input }),
    onSuccess: () => {
      toast.success('Course updated');
      queryClient.invalidateQueries({ queryKey: ['learningCourse', id] });
    },
    onError: (e: any) => toast.error(e.message ?? 'Failed to update'),
  });

  const enrollMutation = useMutation({
    mutationFn: (customerId: string) =>
      api.mutate(ENROLL_LEARNER, { input: { courseId: id, customerId } }),
    onSuccess: () => {
      toast.success('Learner enrolled');
      setEnrollCustomerId('');
      queryClient.invalidateQueries({ queryKey: ['learningCourse', id] });
    },
    onError: (e: any) => toast.error(e.message ?? 'Failed to enroll'),
  });

  const statusVariant = (s: string) =>
    s === 'PUBLISHED' ? 'success' : s === 'CLOSED' ? 'warning' : s === 'ARCHIVED' ? 'secondary' : 'outline';

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (!course) return <div className="text-center text-muted-foreground py-8">Course not found</div>;

  const tabs: Array<{ key: 'overview' | 'tools' | 'users'; label: string }> = [
    { key: 'overview', label: 'Overview' },
    { key: 'tools', label: 'Tools' },
    { key: 'users', label: 'Users' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{course.title}</h1>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant={statusVariant(course.status) as any}>{course.status}</Badge>
            <span className="text-muted-foreground text-sm">/{course.slug}</span>
          </div>
        </div>
      </div>

      {/* Simple tab bar */}
      <div className="flex border-b">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === t.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <Card className="p-4 space-y-4">
          <div>
            <Label htmlFor="title">Title</Label>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
            />
          </div>
          <Button onClick={() => updateMutation.mutate({ title, description })}>
            Save Changes
          </Button>
        </Card>
      )}

      {activeTab === 'tools' && (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tool</TableHead>
                <TableHead>Order</TableHead>
                <TableHead>Visibility</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(course.tools ?? []).map((tool: any) => (
                <TableRow key={tool.id}>
                  <TableCell className="font-medium">{tool.toolKey}</TableCell>
                  <TableCell>{tool.order}</TableCell>
                  <TableCell>
                    <Badge variant={tool.visibility === 'VISIBLE' ? 'success' : 'secondary'}>
                      {tool.visibility}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
              {(!course.tools || course.tools.length === 0) && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground py-4">
                    No tools registered for this course.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      )}

      {activeTab === 'users' && (
        <Card className="p-4 space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="Customer ID to enroll"
              value={enrollCustomerId}
              onChange={(e) => setEnrollCustomerId(e.target.value)}
            />
            <Button
              disabled={!enrollCustomerId}
              onClick={() => enrollMutation.mutate(enrollCustomerId)}
            >
              Enroll
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer ID</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(course.enrollments ?? []).map((enrollment: any) => (
                <TableRow key={enrollment.id}>
                  <TableCell className="font-mono text-sm">{enrollment.customerId}</TableCell>
                  <TableCell>{enrollment.courseRole}</TableCell>
                  <TableCell>
                    <Badge variant={enrollment.status === 'ENROLLED' ? 'success' : 'secondary'}>
                      {enrollment.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
              {(!course.enrollments || course.enrollments.length === 0) && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground py-4">
                    No enrollments yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}

/** Export as a DashboardRouteDefinition for detail navigation */
export const courseDetail: DashboardRouteDefinition = {
  path: '/learning/$id',
  loader: () => ({ breadcrumb: 'Course detail' }),
  component: (route) => <CourseDetailPage route={route as AnyRoute} />,
};

/** Also export the component for direct use in the main route list */
export { CourseDetailPage as CourseDetail };
