import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api, Badge, Button, Card, Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger, Input, Label, Link, Table, TableBody,
  TableCell, TableHead, TableHeader, TableRow, Skeleton,
} from '@vendure/dashboard';
import { toast } from 'sonner';
import { useState } from 'react';
import { graphql } from '@/gql';

const GET_COURSES = graphql(`
  query GetLearningCourses($options: LearningCourseAdminListOptions) {
    learningCourses(options: $options) {
      items { id slug title status description createdAt }
      totalItems
    }
  }
`);

const CREATE_COURSE = graphql(`
  mutation CreateLearningCourse($input: LearningCreateCourseInput!) {
    createLearningCourse(input: $input) { id slug title status }
  }
`);

const PUBLISH_COURSE = graphql(`
  mutation PublishLearningCourse($id: ID!) {
    publishLearningCourse(id: $id) { id status }
  }
`);

const CLOSE_COURSE = graphql(`
  mutation CloseLearningCourse($id: ID!) {
    closeLearningCourse(id: $id) { id status }
  }
`);

export function CoursesList() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newSlug, setNewSlug] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['learningCourses'],
    queryFn: () => api.query(GET_COURSES, { options: { take: 50 } }),
  });

  const createMutation = useMutation({
    mutationFn: (input: { title: string; slug: string }) =>
      api.mutate(CREATE_COURSE, { input }),
    onSuccess: () => {
      toast.success('Course created');
      setShowCreate(false);
      setNewTitle('');
      setNewSlug('');
      queryClient.invalidateQueries({ queryKey: ['learningCourses'] });
    },
    onError: (e: any) => toast.error(e.message ?? 'Failed to create course'),
  });

  const publishMutation = useMutation({
    mutationFn: (id: string) => api.mutate(PUBLISH_COURSE, { id }),
    onSuccess: () => {
      toast.success('Course published');
      queryClient.invalidateQueries({ queryKey: ['learningCourses'] });
    },
    onError: (e: any) => toast.error(e.message ?? 'Failed to publish'),
  });

  const closeMutation = useMutation({
    mutationFn: (id: string) => api.mutate(CLOSE_COURSE, { id }),
    onSuccess: () => {
      toast.success('Course closed');
      queryClient.invalidateQueries({ queryKey: ['learningCourses'] });
    },
    onError: (e: any) => toast.error(e.message ?? 'Failed to close'),
  });

  const slugify = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

  const statusVariant = (status: string) =>
    status === 'PUBLISHED' ? 'success' : status === 'CLOSED' ? 'warning' : status === 'ARCHIVED' ? 'secondary' : 'outline';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Courses</h1>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild>
            <Button>New Course</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Course</DialogTitle>
              <DialogDescription>Enter a title and slug for the new course.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  value={newTitle}
                  onChange={(e) => {
                    setNewTitle(e.target.value);
                    setNewSlug(slugify(e.target.value));
                  }}
                  placeholder="Introduction to Physics"
                />
              </div>
              <div>
                <Label htmlFor="slug">Slug</Label>
                <Input
                  id="slug"
                  value={newSlug}
                  onChange={(e) => setNewSlug(e.target.value)}
                  placeholder="introduction-to-physics"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button
                disabled={!newTitle || !newSlug}
                onClick={() => createMutation.mutate({ title: newTitle, slug: newSlug })}
              >
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.learningCourses?.items?.map((course: any) => (
                <TableRow key={course.id}>
                  <TableCell>
                    <Link href={`/learning/${course.id}`} className="text-blue-600 hover:underline font-medium">
                      {course.title}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{course.slug}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(course.status) as any}>{course.status}</Badge>
                  </TableCell>
                  <TableCell className="space-x-2">
                    {course.status === 'DRAFT' && (
                      <Button size="sm" variant="outline" onClick={() => publishMutation.mutate(course.id)}>
                        Publish
                      </Button>
                    )}
                    {course.status === 'PUBLISHED' && (
                      <Button size="sm" variant="outline" onClick={() => closeMutation.mutate(course.id)}>
                        Close
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {data?.learningCourses?.items?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                    No courses yet. Create your first course.
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
