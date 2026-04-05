import { type GetServerSideProps } from 'next';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect } from 'react';
import { AddOrEditExpensePage } from '~/components/AddExpense/AddExpensePage';
import MainLayout from '~/components/Layout/MainLayout';
import { env } from '~/env';
import { cronFromBackend } from '~/lib/cron';
import { parseCurrencyCode } from '~/lib/currency';
import { isBankConnectionConfigured } from '~/server/bankTransactionHelper';
import { useAddExpenseStore, loadLastSplit, type SplitShares } from '~/store/addStore';
import { SplitType } from '@prisma/client';
import { type NextPageWithUser } from '~/types';
import { api } from '~/utils/api';
import { customServerSideTranslations } from '~/utils/i18n/server';
import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import { toast } from 'sonner';

const AddPage: NextPageWithUser<{
  enableSendingInvites: boolean;
  bankConnectionEnabled: boolean;
}> = ({ user, enableSendingInvites, bankConnectionEnabled }) => {
  const { t, getCurrencyHelpersCached } = useTranslationWithUtils();
  const {
    setCurrentUser,
    setGroup,
    setParticipants,
    setCurrency,
    setAmount,
    setDescription,
    setPaidBy,
    setAmountStr,
    setExpenseDate,
    setCategory,
    resetState,
    setCronExpression,
    setFileKey,
  } = useAddExpenseStore((s) => s.actions);
  const currentUser = useAddExpenseStore((s) => s.currentUser);

  useEffect(() => () => resetState(), [resetState]);

  useEffect(() => {
    setCurrentUser({
      ...user,
      emailVerified: null,
      name: user.name ?? null,
      email: user.email ?? null,
      image: user.image ?? null,
      obapiProviderId: user.obapiProviderId ?? null,
      bankingId: user.bankingId ?? null,
    });
  }, [setCurrentUser, user]);

  const router = useRouter();
  const { friendId, groupId, expenseId } = router.query;

  const _groupId = parseInt(groupId as string);
  const _friendId = parseInt(friendId as string);
  const _expenseId = expenseId as string;
  const groupQuery = api.group.getGroupDetails.useQuery(
    { groupId: _groupId },
    { enabled: Boolean(_groupId) && !_expenseId },
  );

  const friendQuery = api.user.getFriend.useQuery(
    { friendId: _friendId },
    { enabled: Boolean(_friendId) && !_expenseId },
  );

  const expenseQuery = api.expense.getExpenseDetails.useQuery(
    { expenseId: _expenseId },
    { enabled: Boolean(_expenseId) },
  );

  useEffect(() => {
    // Set group
    if (groupId && !groupQuery.isPending && groupQuery.data && currentUser) {
      setGroup(groupQuery.data);

      const allParticipants = [
        currentUser,
        ...groupQuery.data.groupUsers
          .map((gu) => gu.user)
          .filter((user) => user.id !== currentUser.id),
      ];

      setParticipants(allParticipants);
      useAddExpenseStore.setState({ showFriends: false });

      // Restore last-used split config for this group
      const saved = loadLastSplit(
        _groupId,
        allParticipants.map((p) => p.id),
      );
      if (saved) {
        const splitShares: SplitShares = {};
        for (const p of allParticipants) {
          const shares = {} as Record<SplitType, bigint | undefined>;
          for (const type of Object.values(SplitType)) {
            shares[type] = type === saved.splitType
              ? (saved.splitShares[p.id] ?? 0n)
              : undefined;
          }
          splitShares[p.id] = shares;
        }
        useAddExpenseStore.setState({
          splitType: saved.splitType,
          splitShares,
        });
      }
    }
  }, [groupId, groupQuery.isPending, groupQuery.data, currentUser, setGroup, setParticipants, _groupId]);

  useEffect(() => {
    if (friendId && currentUser && friendQuery.data) {
      setParticipants([currentUser, friendQuery.data]);
      useAddExpenseStore.setState({ showFriends: false });
    }
  }, [friendId, friendQuery.isPending, friendQuery.data, currentUser, setParticipants]);

  useEffect(() => {
    if (!_expenseId || !expenseQuery.data) {
      return;
    }

    if (expenseQuery.data.group) {
      setGroup(expenseQuery.data.group);
    }
    setPaidBy(expenseQuery.data.paidByUser);
    setCurrency(parseCurrencyCode(expenseQuery.data.currency));
    setAmountStr(
      getCurrencyHelpersCached(expenseQuery.data.currency).toUIString(
        expenseQuery.data.amount,
        false,
        true,
      ),
    );
    setDescription(expenseQuery.data.name);
    setCategory(expenseQuery.data.category);
    setAmount(expenseQuery.data.amount);
    setParticipants(
      expenseQuery.data.expenseParticipants.map((ep) => ({
        ...ep.user,
        amount: ep.amount,
      })),
      expenseQuery.data.splitType,
    );
    useAddExpenseStore.setState({ showFriends: false });
    setExpenseDate(expenseQuery.data.expenseDate);
    if (expenseQuery.data.recurrence) {
      try {
        const cronExpression = cronFromBackend(expenseQuery.data.recurrence.job.schedule);
        setCronExpression(cronExpression);
      } catch {
        toast.error(t('errors.invalid_cron_expression'));
        console.error(
          `Failed to parse cron expression for expense: ${expenseQuery.data.recurrence.job.schedule}`,
        );
      }
    }
    if (expenseQuery.data.fileKey) {
      setFileKey(expenseQuery.data.fileKey);
    }
  }, [
    _expenseId,
    expenseQuery.data,
    setAmount,
    setAmountStr,
    setCategory,
    setCurrency,
    setDescription,
    setExpenseDate,
    setGroup,
    setPaidBy,
    setParticipants,
    setCronExpression,
    setFileKey,
    getCurrencyHelpersCached,
    t,
  ]);

  return (
    <>
      <Head>
        <title>{_expenseId ? t('actions.edit_expense') : t('actions.add_expense')}</title>
      </Head>
      <MainLayout hideAppBar>
        {currentUser && (!_expenseId || expenseQuery.data) && (
          <AddOrEditExpensePage
            enableSendingInvites={enableSendingInvites}
            expenseId={_expenseId}
            bankConnectionEnabled={Boolean(bankConnectionEnabled)}
          />
        )}
      </MainLayout>
    </>
  );
};

AddPage.auth = true;

export default AddPage;

export const getServerSideProps: GetServerSideProps = async (context) => ({
  props: {
    enableSendingInvites: Boolean(env.ENABLE_SENDING_INVITES),
    bankConnectionEnabled: isBankConnectionConfigured(),
    ...(await customServerSideTranslations(context.locale, ['common', 'categories', 'currencies'])),
  },
});
