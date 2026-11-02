import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, Badge, Button, Card, Input, Label, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Skeleton, Tabs, TabsList, TabsTrigger, TabsContent, Textarea } from '@vendure/dashboard';
import { toast } from 'sonner';
import { useState } from 'react';
import { graphql } from '@/gql';
import { useParams } from '@tanstack/react-router';

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

export function CourseDetail() {
  const { id } = useParams({ from: '/learning/$id' });
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [enrollCustomerId, setEnrollCustomerId] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['learningCourse', id],
    queryFn: () => api.query(GET_COURSE, { id }),
    enabled: !!id,
  });

  // Sync form state when data loads
  if (data?.learningCourse && title === '' && !isLoading) {
    setTitle(data.learningCourse.title);
    setDescription(data.learningCourse.description ?? '');
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
    mutationFn: (input: { courseId: string; customerId: string; courseRole?: string }) =>
      api.mutate(ENROLL_LEARNER, { input }),
    onSuccess: () => {
      toast.success('Learner enrolled');
      setEnrollCustomerId('');
      queryClient.invalidateQueries({ queryKey: ['learningCourse', id] });
    },
    onError: (e: any) => toast.error(e.message ?? 'Failed to enroll'),
  });

  const statusBadge = (status: string) => {
    const variant = status === 'PUBLISHED' ? 'success' : status === 'CLOSED' ? 'warning' : status === 'ARCHIVED' ? 'secondary' : 'outline';
    return <Badge variant={variant as any}>{status}</Badge>;
  };

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  const course = data?.learningCourse;
  if (!course) return <div className="text-center text-muted-foreground py-8">Course not found</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{course.title}</h1>
          <div className="flex items-center gap-2 mt-1">
            {statusBadge(course.status)}
            <span className="text-muted-foreground text-sm">/{course.slug}</span>
          </div>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="tools">Tools</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <Card className="p-4 space-y-4">
            <div>
              <Label htmlFor="title">Title</Label>
              <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="description">Description</Label>
              <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
            </div>
            <Button onClick={() => updateMutation.mutate({ title, description })}>Save Changes</Button>
          </Card>
        </TabsContent>

        <TabsContent value="tools">
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
                {course.tools?.map((tool: any) => (
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
        </TabsContent>

        <TabsContent value="users">
          <Card className="p-4 space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="Customer ID to enroll"
                value={enrollCustomerId}
                onChange={(e) => setEnrollCustomerId(e.target.value)}
              />
              <Button
                disabled={!enrollCustomerId}
                onClick={() => enrollMutation.mutate({ courseId: id, customerId: enrollCustomerId })}
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
                {course.enrollments?.map((enrollment: any) => (
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
        </TabsContent>
      </Tabs>
    </div>
  );
}
