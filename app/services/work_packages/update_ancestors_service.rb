#-- encoding: UTF-8

#-- copyright
# OpenProject is a project management system.
# Copyright (C) 2012-2018 the OpenProject Foundation (OPF)
#
# This program is free software; you can redistribute it and/or
# modify it under the terms of the GNU General Public License version 3.
#
# OpenProject is a fork of ChiliProject, which is a fork of Redmine. The copyright follows:
# Copyright (C) 2006-2017 Jean-Philippe Lang
# Copyright (C) 2010-2013 the ChiliProject Team
#
# This program is free software; you can redistribute it and/or
# modify it under the terms of the GNU General Public License
# as published by the Free Software Foundation; either version 2
# of the License, or (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program; if not, write to the Free Software
# Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.
#
# See docs/COPYRIGHT.rdoc for more details.
#++

class WorkPackages::UpdateAncestorsService
  attr_accessor :user,
                :work_package

  def initialize(user:, work_package:)
    self.user = user
    self.work_package = work_package
  end

  def call(attributes)
    modified = update_ancestors(attributes)
    modified += update_former_ancestors(attributes)

    set_journal_note(modified)

    # Do not send notification for parent updates
    success = JournalManager.with_send_notifications(false) do
      modified.all? { |wp| wp.save(validate: false) }
    end

    result = ServiceResult.new(success: success, result: work_package)

    modified.each do |wp|
      result.add_dependent!(ServiceResult.new(success: !wp.changed?, result: wp))
    end

    result
  end

  private

  def update_ancestors(attributes)
    work_package.ancestors.includes(:status).select do |ancestor|
      inherit_attributes(ancestor, attributes)

      ancestor.changed?
    end
  end

  def update_former_ancestors(attributes)
    return [] unless (%i(parent_id parent) & attributes).any? && previous_parent_id

    parent = WorkPackage.find(previous_parent_id)

    ([parent] + parent.ancestors).each do |ancestor|
      # pass :parent to force update of all inherited attributes
      inherit_attributes(ancestor, %i(parent))
    end.select(&:changed?)
  end

  def inherit_attributes(ancestor, attributes)
    return unless attributes_justify_inheritance?(attributes)

    leaves = leaves_for_ancestor ancestor

    inherit_from_leaves ancestor: ancestor, leaves: leaves, attributes: attributes
  end

  def leaves_for_ancestor(ancestor)
    ancestor
      .leaves
      .select(selected_leaf_attributes)
      .distinct(true) # Be explicit that this is a distinct (wrt ID) query
      .includes(:status).to_a
  end

  def inherit_from_leaves(ancestor:, leaves:, attributes:)
    inherit_done_ratio ancestor, leaves if inherit? attributes, :done_ratio
    derive_estimated_hours ancestor, leaves if inherit? attributes, :estimated_hours
  end

  def inherit?(attributes, attribute)
    [attribute, :parent].any? { |attr| attributes.include? attr }
  end

  def set_journal_note(work_packages)
    work_packages.each do |wp|
      wp.journal_notes = I18n.t('work_package.updated_automatically_by_child_changes', child: "##{work_package.id}")
    end
  end

  def inherit_done_ratio(ancestor, leaves)
    return if WorkPackage.done_ratio_disabled?

    return if WorkPackage.use_status_for_done_ratio? && ancestor.status && ancestor.status.default_done_ratio

    # done ratio = weighted average ratio of leaves
    ratio = aggregate_done_ratio(leaves)

    if ratio
      ancestor.done_ratio = ratio.round
    end
  end

  ##
  # done ratio = weighted average ratio of leaves
  def aggregate_done_ratio(leaves)
    leaves_count = leaves.size

    if leaves_count > 0
      average_story_points = average_story_points(leaves)
      average_estimated_hours = average_estimated_hours(leaves)
      
      
      # we take priority on story points for calculating average and 1 by default
      average = 1
      done_ratio_sum = 1
      if average_story_points > 0
        average = average_story_points
        done_ratio_sum = done_ratio_sum(leaves, true)
      elsif average_estimated_hours > 0
        average = average_estimated_hours
        done_ratio_sum = done_ratio_sum(leaves, false)
      end

      progress = done_ratio_sum / (average * leaves_count)

      progress.round(2)
    end
  end

  def average_estimated_hours(leaves)
    # 0 and nil shall be considered the same for estimated hours
    sum = all_estimated_hours(leaves).sum.to_f
    count = all_estimated_hours(leaves).count

    count = 1 if count.zero?

    average = sum / count
  end

  def average_story_points(leaves)
    # 0 and nil shall be considered the same for estimated hours
    sum = 0
    leaves.map do |leaf|
      sum = sum + leaf_story_points(leaf)
    end
    count = leaves.map.count

    count = 1 if count.zero?

    average = sum.to_f / count
  end

  def leaf_estimated_hours(leaf)
    estimated_hours = if leaf.estimated_hours.to_f > 0
      leaf.estimated_hours
    else
      0
    end
  end

  def leaf_story_points(leaf)
    if leaf[:story_points].present?
      leaf.story_points
    else
      0
    end
  end

  def done_ratio_sum(leaves, using_story_points)
    summands = leaves.map do |leaf|
      # calculate estimation either on story points or estimated hours
      estimation = 1
      if using_story_points
        estimation = leaf_story_points(leaf)
      else
        estimation = leaf_estimated_hours(leaf)
      end

      # calculate done ratio
      done_ratio = if leaf.closed?
                     100
                   else
                     leaf.done_ratio || 0
                   end

      # return weighted done ratio if leaf is not a parent so we avoid counting twice
      estimation * done_ratio
    end

    summands.sum
  end

  def derive_estimated_hours(ancestor, leaves)
    ancestor.derived_estimated_hours = not_zero all_estimated_hours(leaves, derived: true).sum.to_f
  end

  def not_zero(value)
    value unless value.zero?
  end

  def all_estimated_hours(work_packages, derived: false)
    work_packages
      .map { |wp| (derived && wp.derived_estimated_hours) || wp.estimated_hours }
      .reject { |hours| hours.to_f.zero? }
  end

  ##
  # Get the previous parent ID
  # This could either be +parent_id_was+ if parent was changed
  # (when work_package was saved/destroyed)
  # Or the set parent before saving
  def previous_parent_id
    if work_package.parent_id.nil? && work_package.parent_id_was
      work_package.parent_id_was
    else
      previous_change_parent_id
    end
  end

  def previous_change_parent_id
    previous = work_package.previous_changes

    previous_parent_changes = (previous[:parent_id] || previous[:parent])

    previous_parent_changes ? previous_parent_changes.first : nil
  end

  def attributes_justify_inheritance?(attributes)
    (%i(estimated_hours done_ratio parent parent_id status status_id) & attributes).any?
  end

  def selected_leaf_attributes
    %i(id done_ratio derived_estimated_hours estimated_hours story_points status_id)
  end
end
